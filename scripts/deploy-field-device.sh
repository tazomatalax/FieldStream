#!/bin/bash
# Field Device Deployment Script

set -e

echo "=== Field Device Deployment ==="

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    exit 1
fi

# Generate unique device ID if not set
if [ -z "$DEVICE_ID" ]; then
    HOSTNAME=$(hostname)
    TIMESTAMP=$(date +%s)
    DEVICE_ID="field-device-${HOSTNAME}-${TIMESTAMP}"
    echo "Generated device ID: $DEVICE_ID"
fi

# Check environment file or create from template
if [ ! -f ".env" ]; then
    if [ -f ".env.field.example" ]; then
        echo "Creating .env from template..."
        cp .env.field.example .env
        
        # Update device ID in .env file
        sed -i "s/DEVICE_ID=field-device-001/DEVICE_ID=$DEVICE_ID/" .env
        
        echo "Please edit .env file and set your DOMAIN_NAME, then run this script again."
        exit 1
    else
        echo "Error: No .env file and no template found"
        exit 1
    fi
fi

# Validate required environment variables
source .env

if [ -z "$DOMAIN_NAME" ] || [ -z "$DEVICE_ID" ]; then
    echo "Error: DOMAIN_NAME and DEVICE_ID must be set in .env"
    exit 1
fi

# Check certificates
if [ ! -d "certs" ]; then
    echo "Error: Certificates directory not found. Transfer from certificate generation machine."
    exit 1
fi

# Check specific device certificate
if [ ! -f "certs/${DEVICE_ID}.crt" ] && [ ! -f "certs/field-device-001.crt" ]; then
    echo "Warning: Device-specific certificate not found. Using default field-device-001 certificate."
fi

echo "Device ID: $DEVICE_ID"
echo "Server: $DOMAIN_NAME"
echo "Certificates: $(ls certs/ | wc -l) files found"

# Test connectivity to DMZ server
echo "Testing connectivity to DMZ server..."
if command -v curl &> /dev/null; then
    if curl -s --connect-timeout 5 "https://$DOMAIN_NAME" > /dev/null; then
        echo "✓ DMZ server is accessible"
    else
        echo "⚠ DMZ server connectivity test failed - deployment will continue but connection may fail"
    fi
else
    echo "⚠ curl not available - skipping connectivity test"
fi

# Deploy field client
echo "Starting field client..."
cd field-client/
docker-compose down --remove-orphans
docker-compose up --build -d

echo "Waiting for client to start..."
sleep 5

# Check service health
echo "Checking field client status..."
docker-compose ps
docker-compose logs --tail=20

echo ""
echo "=== Field Device Deployment Complete ==="
echo "Field client running with device ID: $DEVICE_ID"
echo "Connecting to: wss://$DOMAIN_NAME/ws"
echo ""
echo "Monitor logs with: docker-compose logs -f"
echo "Stop client with: docker-compose down"
echo ""
echo "To deploy on additional devices:"
echo "1. Copy this directory to the new device"
echo "2. Update DEVICE_ID in .env to be unique"
echo "3. Run this script again"