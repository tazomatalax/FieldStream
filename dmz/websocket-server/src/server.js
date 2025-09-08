const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const mqtt = require('mqtt');

console.log('Starting FieldStream WebSocket Server...');

// --- Connection tracking ---
const activeConnections = new Map();
let connectionId = 0;

// --- Message validation ---
function validateMessage(data) {
    // Basic structure validation
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Invalid message format' };
    }

    if (!data.deviceId || typeof data.deviceId !== 'string') {
        return { valid: false, error: 'Missing or invalid deviceId' };
    }

    // Validate data types
    const validDataTypes = ['timeseries', 'file', 'event', 'response', 'command'];
    if (data.dataType && !validDataTypes.includes(data.dataType)) {
        console.warn(`Unknown data type: ${data.dataType}, will auto-detect`);
    }

    // Size limits
    const messageSize = JSON.stringify(data).length;
    if (messageSize > 10 * 1024 * 1024) { // 10MB limit
        return { valid: false, error: 'Message too large' };
    }

    return { valid: true };
}

function getMQTTTopic(deviceId, dataType, data) {
    // Determine topic based on data type
    switch (dataType) {
        case 'timeseries':
            return `sensors/${deviceId}/data`;
        case 'file':
            return `files/${deviceId}/data`;
        case 'event':
            return `events/${deviceId}/data`;
        case 'response':
            return `commands/${deviceId}/response`;
        case 'command':
            return `commands/${deviceId}/request`;
        default:
            // Auto-detect based on content
            if (data.payload) {
                // Check if it contains numeric sensor data
                const hasNumericData = Object.values(data.payload).some(v => typeof v === 'number');
                if (hasNumericData) {
                    return `sensors/${deviceId}/data`;
                }
                
                // Check if it's a file (has base64 data and filename)
                if (data.payload.data && data.payload.filename) {
                    return `files/${deviceId}/data`;
                }
                
                // Check if it's an event (has eventType or severity)
                if (data.payload.eventType || data.payload.severity) {
                    return `events/${deviceId}/data`;
                }
                
                // Check if it's a command response (has commandId and status)
                if (data.payload.commandId && data.payload.status) {
                    return `commands/${deviceId}/response`;
                }
            }
            
            // Default fallback
            return `sensors/${deviceId}/data`;
    }
}

// --- WebSocket Server Setup ---
const server = http.createServer();
const wss = new WebSocket.Server({
    server,
    verifyClient: (info, done) => {
        // Enhanced client verification
        const origin = info.origin;
        const userAgent = info.req.headers['user-agent'];
        
        console.log(`Client verification - Origin: ${origin}, User-Agent: ${userAgent}`);
        
        // In production, implement proper authentication here
        // Check client certificates, tokens, etc.
        done(true);
    }
});

// --- MQTT Client Setup (with mTLS) ---
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt-broker';
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const CERT_PATH = process.env.CERT_PATH || '/certs';

const mqttOptions = {
    host: MQTT_HOST,
    port: MQTT_PORT,
    protocol: 'mqtts',
    ca: fs.readFileSync(`${CERT_PATH}/ca.crt`),
    cert: fs.readFileSync(`${CERT_PATH}/dmz-server.crt`),
    key: fs.readFileSync(`${CERT_PATH}/dmz-server.key`),
    rejectUnauthorized: true,
    keepalive: 60,
    reconnectPeriod: 1000
};

const mqttClient = mqtt.connect(mqttOptions);

mqttClient.on('connect', () => {
    console.log('Successfully connected to DMZ MQTT broker.');
    
    // Subscribe to command topics for bidirectional communication
    mqttClient.subscribe('commands/+/request', { qos: 1 }, (err) => {
        if (err) {
            console.error('Failed to subscribe to command topics:', err);
        } else {
            console.log('Subscribed to command topics for bidirectional communication');
        }
    });
});

mqttClient.on('error', (err) => {
    console.error('MQTT Connection Error:', err);
});

mqttClient.on('message', (topic, message) => {
    // Handle incoming commands from internal network
    try {
        const topicParts = topic.split('/');
        const deviceId = topicParts[1];
        const command = JSON.parse(message.toString());
        
        console.log(`Received command for device ${deviceId}:`, command);
        
        // Forward command to the appropriate WebSocket client
        const connection = Array.from(activeConnections.values())
            .find(conn => conn.deviceId === deviceId);
            
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify({
                type: 'command',
                payload: command
            }));
            console.log(`Command forwarded to device ${deviceId}`);
        } else {
            console.warn(`Device ${deviceId} not connected - command dropped`);
        }
        
    } catch (error) {
        console.error('Error processing incoming command:', error);
    }
});

// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const connId = ++connectionId;
    
    console.log(`Client ${connId} connected from ${clientIp}`);
    
    // Track connection
    const connectionInfo = {
        id: connId,
        ws: ws,
        ip: clientIp,
        deviceId: null,
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0
    };
    
    activeConnections.set(connId, connectionInfo);

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        connectionId: connId,
        timestamp: new Date().toISOString()
    }));

    ws.on('message', async (message) => {
        try {
            connectionInfo.lastActivity = new Date();
            connectionInfo.messageCount++;
            
            // Parse and validate message
            const data = JSON.parse(message.toString());
            const validation = validateMessage(data);
            
            if (!validation.valid) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: validation.error
                }));
                return;
            }
            
            const deviceId = data.deviceId;
            connectionInfo.deviceId = deviceId;
            
            console.log(`[${new Date().toISOString()}] Message from ${deviceId} (conn:${connId})`);
            console.log(`  Data Type: ${data.dataType || 'auto-detect'}`);
            console.log(`  Message Size: ${JSON.stringify(data).length} bytes`);
            
            // Determine MQTT topic based on data type
            const topic = getMQTTTopic(deviceId, data.dataType, data);
            
            // Prepare message for MQTT (include full context)
            const mqttMessage = JSON.stringify({
                deviceId: deviceId,
                dataType: data.dataType || 'auto-detected',
                timestamp: data.timestamp || new Date().toISOString(),
                payload: data.payload || data,
                metadata: {
                    source: 'websocket',
                    connectionId: connId,
                    clientIp: clientIp
                }
            });
            
            // Publish to MQTT with appropriate QoS
            const qos = data.dataType === 'file' ? 2 : 1; // Higher QoS for files
            
            mqttClient.publish(topic, mqttMessage, { qos }, (err) => {
                if (err) {
                    console.error(`Failed to publish message to MQTT for device ${deviceId}:`, err);
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Failed to forward message'
                    }));
                } else {
                    console.log(`  -> Forwarded to topic: ${topic}`);
                    
                    // Send acknowledgment
                    ws.send(JSON.stringify({
                        type: 'ack',
                        messageId: data.messageId,
                        topic: topic,
                        timestamp: new Date().toISOString()
                    }));
                }
            });

        } catch (error) {
            console.error(`Error processing message from connection ${connId}:`, error);
            
            // Send error response
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Message processing failed'
                }));
            } catch (sendError) {
                console.error('Failed to send error response:', sendError);
            }
            
            // Consider terminating problematic connections
            connectionInfo.messageCount += 10; // Penalty
            if (connectionInfo.messageCount > 1000) {
                console.warn(`Connection ${connId} exceeded message limit - terminating`);
                ws.terminate();
            }
        }
    });

    ws.on('close', () => {
        console.log(`Client ${connId} (${connectionInfo.deviceId || 'unknown'}) disconnected from ${clientIp}`);
        activeConnections.delete(connId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for connection ${connId}:`, error);
        activeConnections.delete(connId);
    });

    // Heartbeat mechanism
    const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ping',
                timestamp: new Date().toISOString()
            }));
        } else {
            clearInterval(heartbeatInterval);
        }
    }, 30000); // 30 second heartbeat
});

// --- Health monitoring ---
setInterval(() => {
    const now = new Date();
    const activeCount = activeConnections.size;
    const deviceCounts = new Map();
    
    activeConnections.forEach(conn => {
        if (conn.deviceId) {
            deviceCounts.set(conn.deviceId, (deviceCounts.get(conn.deviceId) || 0) + 1);
        }
    });
    
    console.log(`[HEALTH] Active connections: ${activeCount}, Unique devices: ${deviceCounts.size}`);
    
    // Clean up stale connections
    activeConnections.forEach((conn, id) => {
        if (now - conn.lastActivity > 300000) { // 5 minutes idle
            console.log(`Cleaning up stale connection ${id}`);
            conn.ws.terminate();
            activeConnections.delete(id);
        }
    });
    
}, 60000); // Every minute

// --- Server startup ---
server.listen(8080, () => {
    console.log('FieldStream WebSocket server listening on port 8080');
    console.log(`MQTT connection to ${MQTT_HOST}:${MQTT_PORT}`);
    console.log('Supported data types: timeseries, file, event, response, command');
});

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
    console.log('Shutting down WebSocket server...');
    
    // Close all WebSocket connections
    activeConnections.forEach((conn, id) => {
        conn.ws.close(1001, 'Server shutdown');
    });
    
    // Close MQTT client
    mqttClient.end();
    
    // Close HTTP server
    server.close(() => {
        console.log('WebSocket server stopped');
        process.exit(0);
    });
});