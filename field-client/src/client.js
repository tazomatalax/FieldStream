const WebSocket = require('ws');
const fs = require('fs');

console.log('Starting FieldStream Field Client...');

const SERVER_URL = process.env.SERVER_URL;
const DEVICE_ID = process.env.DEVICE_ID;
const CERT_PATH = process.env.CERT_PATH || '/certs';

if (!SERVER_URL || !DEVICE_ID) {
    console.error('SERVER_URL and DEVICE_ID environment variables are required.');
    process.exit(1);
}

const wsOptions = {
    // These options are for direct mTLS connection.
    // When connecting through Caddy, Caddy handles server TLS, and client auth is done at the app layer.
    // For this example, we assume Caddy is the entry point, so we just need the public CA.
    // To connect directly with mTLS to a Node.js server, you'd add:
    // cert: fs.readFileSync(`${CERT_PATH}/${DEVICE_ID}.crt`),
    // key: fs.readFileSync(`${CERT_PATH}/${DEVICE_ID}.key`),
    ca: fs.readFileSync(`${CERT_PATH}/ca.crt`)
};

let ws;
let reconnectInterval = 1000; // Start with 1 second

function connect() {
    console.log(`Attempting to connect to ${SERVER_URL}`);
    ws = new WebSocket(SERVER_URL, wsOptions);

    ws.on('open', () => {
        console.log('Connection established.');
        reconnectInterval = 1000; // Reset reconnect interval on successful connection
        startSendingData();
    });

    ws.on('message', (data) => {
        console.log('Received message from server:', data.toString());
    });

    ws.on('close', () => {
        console.warn('Connection closed. Attempting to reconnect...');
        stopSendingData();
        setTimeout(connect, reconnectInterval);
        // Exponential backoff
        if (reconnectInterval < 30000) {
            reconnectInterval *= 2;
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        // The 'close' event will fire after this, triggering reconnection logic.
    });
}

let dataInterval;
function startSendingData() {
    console.log('Starting to send data every 5 seconds...');
    dataInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            const payload = {
                timestamp: new Date().toISOString(),
                temperature: (20 + Math.random() * 5).toFixed(2),
                humidity: (50 + Math.random() * 10).toFixed(2),
            };

            const message = JSON.stringify({
                deviceId: DEVICE_ID,
                payload: payload
            });

            ws.send(message);
            console.log('Sent data:', message);
        }
    }, 5000);
}

function stopSendingData() {
    clearInterval(dataInterval);
}

connect();