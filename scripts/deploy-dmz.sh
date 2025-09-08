#!/bin/bash
# DMZ Server Deployment Script

set -e

echo "=== DMZ Server Deployment ==="

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
if [ ! -f ".env" ]; then
    echo "Error: .env file not found. Copy .env.dmz.example to .env and configure it."
    exit 1
fi

# Validate required environment variables
source .env

if [ -z "$DOMAIN_NAME" ] || [ -z "$ADMIN_EMAIL" ]; then
    echo "Error: DOMAIN_NAME and ADMIN_EMAIL must be set in .env"
    exit 1
fi

# Check certificates
if [ ! -d "certs" ]; then
    echo "Error: Certificates directory not found. Run generate-certificates.sh first."
    exit 1
fi

echo "Domain: $DOMAIN_NAME"
echo "Email: $ADMIN_EMAIL"
echo "Certificates: $(ls certs/ | wc -l) files found"

# Set up firewall (with confirmation)
echo -n "Apply firewall rules? (y/n): "
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    echo "Applying firewall rules..."
    sudo ./scripts/setup-firewall.sh
    echo "Firewall rules applied"
fi

# Deploy services
echo "Starting DMZ services..."
cd dmz/
docker-compose down --remove-orphans
docker-compose up --build -d

echo "Waiting for services to start..."
sleep 10

# Check service health
echo "Checking service health..."
docker-compose ps
docker-compose logs --tail=20

echo ""
echo "=== DMZ Deployment Complete ==="
echo "Services available at:"
echo "  - HTTPS: https://$DOMAIN_NAME"
echo "  - WebSocket: wss://$DOMAIN_NAME/ws"
echo ""
echo "Monitor logs with: docker-compose logs -f"
echo "Stop services with: docker-compose down"