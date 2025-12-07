const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

console.log('Starting FieldStream Data Distributor...');

// --- Environment Configuration ---
const MQTT_HOST = process.env.MQTT_HOST || 'internal-mqtt-broker';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const CERT_PATH = process.env.CERT_PATH || '/certs';
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';
const FILE_STORAGE_TYPE = process.env.FILE_STORAGE_TYPE || 'local';

// Multi-tenancy strategy: 'tags' (single bucket with tenant tags) or 'buckets' (per-tenant buckets)
const INFLUX_TENANT_STRATEGY = process.env.INFLUX_TENANT_STRATEGY || 'tags';

// --- InfluxDB Configuration ---
let influxClient;
let influxWriteApi;
let influxOrg;

// Tenant bucket cache (for 'buckets' strategy)
const tenantBuckets = new Map();

// Initialize InfluxDB client (v2.x)
if (process.env.INFLUXDB_URL && process.env.INFLUXDB_TOKEN) {
    const { InfluxDB, Point } = require('@influxdata/influxdb-client');
    const { BucketsAPI } = require('@influxdata/influxdb-client-apis');
    
    influxClient = new InfluxDB({
        url: process.env.INFLUXDB_URL,
        token: process.env.INFLUXDB_TOKEN
    });
    
    influxOrg = process.env.INFLUXDB_ORG;
    
    // Default write API for shared bucket (tags strategy)
    if (INFLUX_TENANT_STRATEGY === 'tags') {
        influxWriteApi = influxClient.getWriteApi(
            influxOrg,
            process.env.INFLUXDB_BUCKET,
            'ms'
        );
        console.log(`InfluxDB v2.x client initialized (strategy: tags, bucket: ${process.env.INFLUXDB_BUCKET})`);
    } else {
        console.log(`InfluxDB v2.x client initialized (strategy: buckets)`);
    }
}
// Initialize InfluxDB client (v1.x legacy)
else if (process.env.INFLUXDB_DATABASE && process.env.INFLUXDB_URL) {
    const Influx = require('influx');
    
    influxClient = new Influx.InfluxDB({
        host: process.env.INFLUXDB_URL.replace(/^https?:\/\//, '').split(':')[0],
        port: parseInt(process.env.INFLUXDB_URL.split(':')[2] || '8086'),
        database: process.env.INFLUXDB_DATABASE,
        username: process.env.INFLUXDB_USERNAME,
        password: process.env.INFLUXDB_PASSWORD,
        protocol: process.env.INFLUXDB_URL.startsWith('https') ? 'https' : 'http'
    });
    
    console.log('InfluxDB v1.x client initialized');
}

// Get or create tenant bucket (for 'buckets' strategy)
async function getTenantBucket(tenantId) {
    if (!tenantId || INFLUX_TENANT_STRATEGY !== 'buckets') {
        return process.env.INFLUXDB_BUCKET;
    }
    
    const bucketName = `tenant-${tenantId}`;
    
    if (tenantBuckets.has(tenantId)) {
        return tenantBuckets.get(tenantId);
    }
    
    try {
        const { BucketsAPI } = require('@influxdata/influxdb-client-apis');
        const bucketsAPI = new BucketsAPI(influxClient);
        
        // Try to find existing bucket
        const buckets = await bucketsAPI.getBuckets({ name: bucketName, orgID: influxOrg });
        
        if (buckets.buckets && buckets.buckets.length > 0) {
            tenantBuckets.set(tenantId, bucketName);
            console.log(`Found existing bucket for tenant ${tenantId}`);
            return bucketName;
        }
        
        // Create new bucket for tenant
        const retentionDays = parseInt(process.env.INFLUXDB_RETENTION_DAYS || '30');
        await bucketsAPI.postBuckets({
            body: {
                name: bucketName,
                orgID: influxOrg,
                retentionRules: [{
                    type: 'expire',
                    everySeconds: retentionDays * 24 * 60 * 60
                }]
            }
        });
        
        tenantBuckets.set(tenantId, bucketName);
        console.log(`Created new bucket for tenant ${tenantId} with ${retentionDays} day retention`);
        return bucketName;
    } catch (error) {
        console.error(`Error managing bucket for tenant ${tenantId}:`, error.message);
        // Fallback to default bucket
        return process.env.INFLUXDB_BUCKET;
    }
}

// Get write API for tenant
function getWriteApiForTenant(tenantId) {
    if (INFLUX_TENANT_STRATEGY === 'tags' || !tenantId) {
        return influxWriteApi;
    }
    
    const bucketName = tenantBuckets.get(tenantId) || `tenant-${tenantId}`;
    return influxClient.getWriteApi(influxOrg, bucketName, 'ms');
}

// --- Data Processing Functions ---
async function handleTimeSeriesData(deviceId, data, tenantId = null) {
    if (!influxClient) {
        console.warn('No InfluxDB client configured - skipping time series data');
        return;
    }

    try {
        const timestamp = new Date(data.timestamp || Date.now());
        
        // Ensure bucket exists for tenant (buckets strategy)
        if (INFLUX_TENANT_STRATEGY === 'buckets' && tenantId) {
            await getTenantBucket(tenantId);
        }
        
        const writeApi = getWriteApiForTenant(tenantId);
        
        if (writeApi) {
            // InfluxDB v2.x
            const { Point } = require('@influxdata/influxdb-client');
            
            Object.entries(data.payload || data).forEach(([field, value]) => {
                if (field !== 'timestamp' && typeof value === 'number') {
                    const point = new Point('sensor_data')
                        .tag('device_id', deviceId)
                        .tag('data_type', data.dataType || 'timeseries');
                    
                    // Add tenant tag for multi-tenancy (tags strategy)
                    if (tenantId) {
                        point.tag('tenant_id', tenantId);
                    }
                    
                    point.floatField(field, value)
                        .timestamp(timestamp);
                    
                    writeApi.writePoint(point);
                }
            });
            
            await writeApi.flush();
            console.log(`  -> Written time series data to InfluxDB for device '${deviceId}'${tenantId ? ` (tenant: ${tenantId})` : ''}`);
            
        } else if (influxClient && influxClient.writePoints) {
            // InfluxDB v1.x
            const fields = {};
            Object.entries(data.payload || data).forEach(([field, value]) => {
                if (field !== 'timestamp' && typeof value === 'number') {
                    fields[field] = value;
                }
            });
            
            if (Object.keys(fields).length > 0) {
                const tags = { 
                    device_id: deviceId,
                    data_type: data.dataType || 'timeseries'
                };
                if (tenantId) tags.tenant_id = tenantId;
                
                await influxClient.writePoints([{
                    measurement: 'sensor_data',
                    tags,
                    fields: fields,
                    timestamp: timestamp
                }]);
                
                console.log(`  -> Written time series data to InfluxDB v1.x for device '${deviceId}'`);
            }
        }
        
    } catch (error) {
        console.error('Error writing to InfluxDB:', error);
    }
}

async function handleFileData(deviceId, data, tenantId = null) {
    try {
        const filename = data.payload.filename || `${deviceId}_${Date.now()}.bin`;
        const fileData = Buffer.from(data.payload.data || '', 'base64');
        
        // Organize files by tenant if available
        const basePath = tenantId 
            ? path.join(FILE_STORAGE_PATH, tenantId, deviceId)
            : path.join(FILE_STORAGE_PATH, deviceId);
        const filePath = path.join(basePath, filename);
        
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write file
        fs.writeFileSync(filePath, fileData);
        
        // Ensure bucket exists for tenant (buckets strategy)
        if (INFLUX_TENANT_STRATEGY === 'buckets' && tenantId) {
            await getTenantBucket(tenantId);
        }
        
        const writeApi = getWriteApiForTenant(tenantId);
        
        // Store metadata in InfluxDB
        if (writeApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('file_metadata')
                .tag('device_id', deviceId)
                .tag('filename', filename)
                .tag('content_type', data.payload.contentType || 'application/octet-stream');
            
            if (tenantId) point.tag('tenant_id', tenantId);
            
            point.intField('file_size', fileData.length)
                .stringField('file_path', filePath)
                .timestamp(new Date(data.payload.metadata?.timestamp || Date.now()));
                
            writeApi.writePoint(point);
            await writeApi.flush();
        }
        
        console.log(`  -> Stored file '${filename}' (${fileData.length} bytes) for device '${deviceId}'${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        
    } catch (error) {
        console.error('Error handling file data:', error);
    }
}

async function handleEventData(deviceId, data, tenantId = null) {
    try {
        // Ensure bucket exists for tenant (buckets strategy)
        if (INFLUX_TENANT_STRATEGY === 'buckets' && tenantId) {
            await getTenantBucket(tenantId);
        }
        
        const writeApi = getWriteApiForTenant(tenantId);
        
        // Store event in InfluxDB
        if (writeApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('events')
                .tag('device_id', deviceId)
                .tag('event_type', data.payload.eventType || 'unknown')
                .tag('severity', data.payload.severity || 'info');
            
            if (tenantId) point.tag('tenant_id', tenantId);
            
            point.stringField('message', data.payload.message || '')
                .intField('count', 1)
                .timestamp(new Date(data.payload.timestamp || Date.now()));
                
            writeApi.writePoint(point);
            await writeApi.flush();
        } else if (influxClient && influxClient.writePoints) {
            // InfluxDB v1.x
            const tags = { 
                device_id: deviceId,
                event_type: data.payload.eventType || 'unknown',
                severity: data.payload.severity || 'info'
            };
            if (tenantId) tags.tenant_id = tenantId;
            
            await influxClient.writePoints([{
                measurement: 'events',
                tags,
                fields: {
                    message: data.payload.message || '',
                    count: 1
                },
                timestamp: new Date(data.payload.timestamp || Date.now())
            }]);
        }
        
        console.log(`  -> Stored event '${data.payload.eventType}' for device '${deviceId}'${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        
    } catch (error) {
        console.error('Error handling event data:', error);
    }
}

async function handleResponseData(deviceId, data, tenantId = null) {
    try {
        // Ensure bucket exists for tenant (buckets strategy)
        if (INFLUX_TENANT_STRATEGY === 'buckets' && tenantId) {
            await getTenantBucket(tenantId);
        }
        
        const writeApi = getWriteApiForTenant(tenantId);
        
        // Store command response in InfluxDB
        if (writeApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('command_responses')
                .tag('device_id', deviceId)
                .tag('command_id', data.payload.commandId || 'unknown')
                .tag('status', data.payload.status || 'unknown');
            
            if (tenantId) point.tag('tenant_id', tenantId);
            
            point.stringField('result', data.payload.result || '')
                .intField('response_time_ms', data.payload.responseTime || 0)
                .timestamp(new Date(data.payload.timestamp || Date.now()));
                
            writeApi.writePoint(point);
            await writeApi.flush();
        } else if (influxClient && influxClient.writePoints) {
            // InfluxDB v1.x
            const tags = { 
                device_id: deviceId,
                command_id: data.payload.commandId || 'unknown',
                status: data.payload.status || 'unknown'
            };
            if (tenantId) tags.tenant_id = tenantId;
            
            await influxClient.writePoints([{
                measurement: 'command_responses',
                tags,
                fields: {
                    result: data.payload.result || '',
                    response_time_ms: data.payload.responseTime || 0
                },
                timestamp: new Date(data.payload.timestamp || Date.now())
            }]);
        }
        
        console.log(`  -> Stored command response for device '${deviceId}'${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        
    } catch (error) {
        console.error('Error handling response data:', error);
    }
}

async function handleGenericData(deviceId, data, tenantId = null) {
    // Fallback handler for any other data types
    try {
        // Try to detect if it's numeric time-series data
        const payload = data.payload || data;
        const hasNumericFields = Object.values(payload).some(v => typeof v === 'number');
        
        if (hasNumericFields) {
            console.log(`  -> Treating unknown data type as time-series for device '${deviceId}'`);
            await handleTimeSeriesData(deviceId, data, tenantId);
        } else {
            // Ensure bucket exists for tenant (buckets strategy)
            if (INFLUX_TENANT_STRATEGY === 'buckets' && tenantId) {
                await getTenantBucket(tenantId);
            }
            
            const writeApi = getWriteApiForTenant(tenantId);
            
            // Store as generic event
            if (writeApi) {
                const { Point } = require('@influxdata/influxdb-client');
                const point = new Point('generic_data')
                    .tag('device_id', deviceId)
                    .tag('data_type', data.dataType || 'unknown');
                
                if (tenantId) point.tag('tenant_id', tenantId);
                
                point.stringField('raw_data', JSON.stringify(payload))
                    .timestamp(new Date(data.timestamp || Date.now()));
                    
                writeApi.writePoint(point);
                await writeApi.flush();
            }
            
            console.log(`  -> Stored generic data for device '${deviceId}'${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        }
        
    } catch (error) {
        console.error('Error handling generic data:', error);
    }
}

// --- MQTT Client Setup (with mTLS) ---
const mqttOptions = {
    host: MQTT_HOST,
    port: MQTT_PORT,
    protocol: 'mqtts',
    ca: fs.readFileSync(`${CERT_PATH}/ca.crt`),
    cert: fs.readFileSync(`${CERT_PATH}/data-distributor.crt`),
    key: fs.readFileSync(`${CERT_PATH}/data-distributor.key`),
    rejectUnauthorized: true
};

const client = mqtt.connect(mqttOptions);

client.on('connect', () => {
    console.log('Successfully connected to Internal MQTT broker.');
    
    // Subscribe to legacy and tenant-aware topics
    const topics = [
        // Legacy topics
        'sensors/+/data',
        'events/+/data',
        'commands/+/response',
        'files/+/data',
        // Tenant-aware topics
        'tenants/+/devices/+/sensors/data',
        'tenants/+/devices/+/events/data',
        'tenants/+/devices/+/commands/response',
        'tenants/+/devices/+/files/data'
    ];
    
    topics.forEach(topic => {
        client.subscribe(topic, { qos: 1 }, (err) => {
            if (!err) {
                console.log(`Subscribed to topic: ${topic}`);
            } else {
                console.error(`Subscription failed for ${topic}:`, err);
            }
        });
    });
});

client.on('message', async (topic, message) => {
    try {
        const topicParts = topic.split('/');
        // Support both legacy and tenant-aware topics
        let deviceId;
        let tenantId;
        if (topic.startsWith('tenants/')) {
            tenantId = topicParts[1];
            // tenants/{tenantId}/devices/{deviceId}/.../data
            deviceId = topicParts[3];
        } else {
            deviceId = topicParts[1];
        }
        const data = JSON.parse(message.toString());
        
        // Extract tenant from metadata if not in topic
        if (!tenantId && data.metadata?.tenantId) {
            tenantId = data.metadata.tenantId;
        }

        console.log(`[${new Date().toISOString()}] Received data from device '${deviceId}'`);
        console.log('  Topic:', topic);
        console.log('  Data Type:', data.dataType || 'auto-detected');
        if (tenantId) {
            console.log('  Tenant:', tenantId);
        }

        // Route data based on type (pass tenantId for multi-tenancy)
        switch (data.dataType) {
            case 'timeseries':
                await handleTimeSeriesData(deviceId, data, tenantId);
                break;
                
            case 'file':
                await handleFileData(deviceId, data, tenantId);
                break;
                
            case 'event':
                await handleEventData(deviceId, data, tenantId);
                break;
                
            case 'response':
                await handleResponseData(deviceId, data, tenantId);
                break;
                
            default:
                // Auto-detect based on topic or content
                if (topic.includes('/files/')) {
                    await handleFileData(deviceId, data, tenantId);
                } else if (topic.includes('/events/')) {
                    await handleEventData(deviceId, data, tenantId);
                } else if (topic.includes('/response')) {
                    await handleResponseData(deviceId, data, tenantId);
                } else {
                    // Default to generic/time-series handling
                    await handleGenericData(deviceId, data, tenantId);
                }
                break;
        }

    } catch (error) {
        console.error('Error processing incoming MQTT message:', error);
        console.error('Topic:', topic);
        console.error('Raw message:', message.toString());
    }
});

client.on('error', (err) => {
    console.error('MQTT Connection Error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    
    if (influxWriteApi) {
        try {
            await influxWriteApi.close();
            console.log('InfluxDB write API closed');
        } catch (error) {
            console.error('Error closing InfluxDB:', error);
        }
    }
    
    client.end();
    process.exit(0);
});