#!/bin/bash
# Send test data to verify FieldStream connection

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== FieldStream Test Data Transmission ==="

# Load environment
if [ -f ".env" ]; then
    source .env
else
    echo -e "${RED}✗${NC} No .env file found"
    exit 1
fi

# Check if client is running
if [ -d "field-client" ]; then
    cd field-client/
fi

if ! docker-compose ps | grep -q "Up"; then
    echo -e "${RED}✗${NC} FieldStream client is not running"
    echo "Start it with: docker-compose up -d"
    exit 1
fi

echo "Device ID: $DEVICE_ID"
echo "Server: $DOMAIN_NAME"
echo

# Function to send test data via the running container
send_test_message() {
    local data_type=$1
    local test_data=$2
    
    echo "Sending $data_type test data..."
    
    # Create a test script inside the container
    docker-compose exec -T field-client sh -c "
cat > /tmp/test-data.js << 'EOF'
const WebSocket = require('ws');
const fs = require('fs');

const SERVER_URL = process.env.SERVER_URL;
const DEVICE_ID = process.env.DEVICE_ID;

console.log('Connecting to: ' + SERVER_URL);

const ws = new WebSocket(SERVER_URL, {
    ca: fs.readFileSync('/certs/ca.crt')
});

const testData = $test_data;

ws.on('open', () => {
    console.log('Connected - sending test data');
    ws.send(JSON.stringify(testData));
});

ws.on('message', (data) => {
    const response = JSON.parse(data.toString());
    console.log('Response:', response.type);
    if (response.type === 'ack') {
        console.log('✓ Test data acknowledged');
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('Timeout waiting for response');
    process.exit(1);
}, 10000);
EOF

node /tmp/test-data.js
"
    
    return $?
}

echo "1. Testing sensor data transmission..."

SENSOR_DATA='{
    "deviceId": "'$DEVICE_ID'",
    "dataType": "timeseries", 
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "payload": {
        "temperature": 23.5,
        "humidity": 65.2,
        "pressure": 1013.25,
        "test": true
    }
}'

if send_test_message "sensor" "$SENSOR_DATA"; then
    echo -e "${GREEN}✓${NC} Sensor data test passed"
else
    echo -e "${RED}✗${NC} Sensor data test failed"
    exit 1
fi

echo
echo "2. Testing event data transmission..."

EVENT_DATA='{
    "deviceId": "'$DEVICE_ID'",
    "dataType": "event",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "payload": {
        "eventType": "system_test",
        "severity": "info", 
        "message": "Connection test from field device",
        "test": true
    }
}'

if send_test_message "event" "$EVENT_DATA"; then
    echo -e "${GREEN}✓${NC} Event data test passed"
else
    echo -e "${YELLOW}⚠${NC} Event data test failed (may not be critical)"
fi

echo
echo "3. Testing file data transmission..."

# Create a small test file (base64 encoded)
TEST_FILE_DATA=$(echo "Test file from device $DEVICE_ID at $(date)" | base64 -w 0)

FILE_DATA='{
    "deviceId": "'$DEVICE_ID'",
    "dataType": "file",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "payload": {
        "filename": "test-'$(date +%Y%m%d-%H%M%S)'.txt",
        "contentType": "text/plain",
        "data": "'$TEST_FILE_DATA'",
        "metadata": {
            "size": '$(echo -n "$TEST_FILE_DATA" | wc -c)',
            "test": true
        }
    }
}'

if send_test_message "file" "$FILE_DATA"; then
    echo -e "${GREEN}✓${NC} File data test passed"
else
    echo -e "${YELLOW}⚠${NC} File data test failed (may not be critical)"
fi

echo
echo -e "${GREEN}=== Test Summary ===${NC}"
echo "✓ Basic connectivity works"
echo "✓ Data can be sent to server"
echo "✓ Server acknowledges messages"
echo
echo "Your field device is ready to collect and transmit data!"
echo
echo "Monitor real-time transmission with:"
echo "  docker-compose logs -f --tail=20"
echo
echo "Check device status with:"
echo "  ./status.sh"