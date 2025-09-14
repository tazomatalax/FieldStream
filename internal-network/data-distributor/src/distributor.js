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

// --- InfluxDB Configuration ---
let influxClient;
let influxWriteApi;

// Initialize InfluxDB client (v2.x)
if (process.env.INFLUXDB_URL && process.env.INFLUXDB_TOKEN) {
    const { InfluxDB, Point } = require('@influxdata/influxdb-client');
    
    influxClient = new InfluxDB({
        url: process.env.INFLUXDB_URL,
        token: process.env.INFLUXDB_TOKEN
    });
    
    influxWriteApi = influxClient.getWriteApi(
        process.env.INFLUXDB_ORG,
        process.env.INFLUXDB_BUCKET,
        'ms'
    );
    
    console.log('InfluxDB v2.x client initialized');
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

// --- Data Processing Functions ---
async function handleTimeSeriesData(deviceId, data) {
    if (!influxClient) {
        console.warn('No InfluxDB client configured - skipping time series data');
        return;
    }

    try {
        const timestamp = new Date(data.timestamp || Date.now());
        
        if (influxWriteApi) {
            // InfluxDB v2.x
            const { Point } = require('@influxdata/influxdb-client');
            
            Object.entries(data.payload || data).forEach(([field, value]) => {
                if (field !== 'timestamp' && typeof value === 'number') {
                    const point = new Point('sensor_data')
                        .tag('device_id', deviceId)
                        .tag('data_type', data.dataType || 'timeseries')
                        .floatField(field, value)
                        .timestamp(timestamp);
                    
                    influxWriteApi.writePoint(point);
                }
            });
            
            await influxWriteApi.flush();
            console.log(`  -> Written time series data to InfluxDB v2.x for device '${deviceId}'`);
            
        } else {
            // InfluxDB v1.x
            const fields = {};
            Object.entries(data.payload || data).forEach(([field, value]) => {
                if (field !== 'timestamp' && typeof value === 'number') {
                    fields[field] = value;
                }
            });
            
            if (Object.keys(fields).length > 0) {
                await influxClient.writePoints([{
                    measurement: 'sensor_data',
                    tags: { 
                        device_id: deviceId,
                        data_type: data.dataType || 'timeseries'
                    },
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

async function handleFileData(deviceId, data) {
    try {
        const filename = data.payload.filename || `${deviceId}_${Date.now()}.bin`;
        const fileData = Buffer.from(data.payload.data || '', 'base64');
        const filePath = path.join(FILE_STORAGE_PATH, deviceId, filename);
        
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write file
        fs.writeFileSync(filePath, fileData);
        
        // Store metadata in InfluxDB
        if (influxWriteApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('file_metadata')
                .tag('device_id', deviceId)
                .tag('filename', filename)
                .tag('content_type', data.payload.contentType || 'application/octet-stream')
                .intField('file_size', fileData.length)
                .stringField('file_path', filePath)
                .timestamp(new Date(data.payload.metadata?.timestamp || Date.now()));
                
            influxWriteApi.writePoint(point);
            await influxWriteApi.flush();
        }
        
        console.log(`  -> Stored file '${filename}' (${fileData.length} bytes) for device '${deviceId}'`);
        
    } catch (error) {
        console.error('Error handling file data:', error);
    }
}

async function handleEventData(deviceId, data) {
    try {
        // Store event in InfluxDB
        if (influxWriteApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('events')
                .tag('device_id', deviceId)
                .tag('event_type', data.payload.eventType || 'unknown')
                .tag('severity', data.payload.severity || 'info')
                .stringField('message', data.payload.message || '')
                .intField('count', 1)
                .timestamp(new Date(data.payload.timestamp || Date.now()));
                
            influxWriteApi.writePoint(point);
            await influxWriteApi.flush();
        } else if (influxClient && influxClient.writePoints) {
            // InfluxDB v1.x
            await influxClient.writePoints([{
                measurement: 'events',
                tags: { 
                    device_id: deviceId,
                    event_type: data.payload.eventType || 'unknown',
                    severity: data.payload.severity || 'info'
                },
                fields: {
                    message: data.payload.message || '',
                    count: 1
                },
                timestamp: new Date(data.payload.timestamp || Date.now())
            }]);
        }
        
        console.log(`  -> Stored event '${data.payload.eventType}' for device '${deviceId}'`);
        
    } catch (error) {
        console.error('Error handling event data:', error);
    }
}

async function handleResponseData(deviceId, data) {
    try {
        // Store command response in InfluxDB
        if (influxWriteApi) {
            const { Point } = require('@influxdata/influxdb-client');
            const point = new Point('command_responses')
                .tag('device_id', deviceId)
                .tag('command_id', data.payload.commandId || 'unknown')
                .tag('status', data.payload.status || 'unknown')
                .stringField('result', data.payload.result || '')
                .intField('response_time_ms', data.payload.responseTime || 0)
                .timestamp(new Date(data.payload.timestamp || Date.now()));
                
            influxWriteApi.writePoint(point);
            await influxWriteApi.flush();
        } else if (influxClient && influxClient.writePoints) {
            // InfluxDB v1.x
            await influxClient.writePoints([{
                measurement: 'command_responses',
                tags: { 
                    device_id: deviceId,
                    command_id: data.payload.commandId || 'unknown',
                    status: data.payload.status || 'unknown'
                },
                fields: {
                    result: data.payload.result || '',
                    response_time_ms: data.payload.responseTime || 0
                },
                timestamp: new Date(data.payload.timestamp || Date.now())
            }]);
        }
        
        console.log(`  -> Stored command response for device '${deviceId}'`);
        
    } catch (error) {
        console.error('Error handling response data:', error);
    }
}

async function handleGenericData(deviceId, data) {
    // Fallback handler for any other data types
    try {
        // Try to detect if it's numeric time-series data
        const payload = data.payload || data;
        const hasNumericFields = Object.values(payload).some(v => typeof v === 'number');
        
        if (hasNumericFields) {
            console.log(`  -> Treating unknown data type as time-series for device '${deviceId}'`);
            await handleTimeSeriesData(deviceId, data);
        } else {
            // Store as generic event
            if (influxWriteApi) {
                const { Point } = require('@influxdata/influxdb-client');
                const point = new Point('generic_data')
                    .tag('device_id', deviceId)
                    .tag('data_type', data.dataType || 'unknown')
                    .stringField('raw_data', JSON.stringify(payload))
                    .timestamp(new Date(data.timestamp || Date.now()));
                    
                influxWriteApi.writePoint(point);
                await influxWriteApi.flush();
            }
            
            console.log(`  -> Stored generic data for device '${deviceId}'`);
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

        console.log(`[${new Date().toISOString()}] Received data from device '${deviceId}'`);
        console.log('  Topic:', topic);
        console.log('  Data Type:', data.dataType || 'auto-detected');
        if (tenantId) {
            console.log('  Tenant:', tenantId);
        }

        // Route data based on type
        switch (data.dataType) {
            case 'timeseries':
                await handleTimeSeriesData(deviceId, data);
                break;
                
            case 'file':
                await handleFileData(deviceId, data);
                break;
                
            case 'event':
                await handleEventData(deviceId, data);
                break;
                
            case 'response':
                await handleResponseData(deviceId, data);
                break;
                
            default:
                // Auto-detect based on topic or content
                if (topic.startsWith('files/')) {
                    await handleFileData(deviceId, data);
                } else if (topic.startsWith('events/')) {
                    await handleEventData(deviceId, data);
                } else if (topic.endsWith('/response')) {
                    await handleResponseData(deviceId, data);
                } else {
                    // Default to generic/time-series handling
                    await handleGenericData(deviceId, data);
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