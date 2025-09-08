#!/bin/bash
# Internal Network Deployment Script

set -e

echo "=== Internal Network Deployment ==="

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    exit 1
fi

# Check environment file
if [ ! -f ".env.internal" ]; then
    echo "Error: .env.internal file not found. Copy .env.internal.example and configure it."
    exit 1
fi

# Validate required environment variables
source .env.internal

if [ -z "$INFLUXDB_URL" ]; then
    echo "Error: InfluxDB configuration is required. Set INFLUXDB_URL and related variables."
    exit 1
fi

# Check certificates
if [ ! -d "certs" ]; then
    echo "Error: Certificates directory not found. Transfer from certificate generation machine."
    exit 1
fi

echo "InfluxDB URL: $INFLUXDB_URL"
echo "File storage: $FILE_STORAGE_TYPE at $FILE_STORAGE_PATH"
echo "Certificates: $(ls certs/ | wc -l) files found"

# Test InfluxDB connectivity
echo "Testing InfluxDB connectivity..."
if command -v curl &> /dev/null; then
    if curl -s --connect-timeout 5 "$INFLUXDB_URL/ping" > /dev/null; then
        echo "✓ InfluxDB is accessible"
    else
        echo "⚠ InfluxDB connectivity test failed - deployment will continue but may fail"
    fi
else
    echo "⚠ curl not available - skipping InfluxDB connectivity test"
fi

# Deploy services
echo "Starting internal services..."
cd internal-network/
docker-compose --env-file ../.env.internal down --remove-orphans
docker-compose --env-file ../.env.internal up --build -d

echo "Waiting for services to start..."
sleep 10

# Check service health
echo "Checking service health..."
docker-compose --env-file ../.env.internal ps
docker-compose --env-file ../.env.internal logs --tail=20

echo ""
echo "=== Internal Network Deployment Complete ==="
echo "Services running:"
echo "  - Internal MQTT Broker: localhost:18883"
echo "  - Data Distributor: processing messages"
echo ""
echo "Monitor logs with: docker-compose --env-file ../.env.internal logs -f"
echo "Stop services with: docker-compose --env-file ../.env.internal down"