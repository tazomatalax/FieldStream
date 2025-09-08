#!/bin/bash
# Create deployment bundle for field devices
# Run this on the machine where certificates were generated

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=== FieldStream Device Bundle Creator ==="

# Check if we have certificates
if [ ! -d "certs" ] || [ ! -f "certs/ca.crt" ]; then
    echo -e "${RED}✗${NC} Certificates not found. Run generate-certificates.sh first."
    exit 1
fi

# Get device ID from command line or prompt
DEVICE_ID="$1"
if [ -z "$DEVICE_ID" ]; then
    echo -n "Enter device ID (e.g., process-site-01): "
    read -r DEVICE_ID
fi

if [ -z "$DEVICE_ID" ]; then
    echo -e "${RED}✗${NC} Device ID is required"
    exit 1
fi

# Get domain name
DOMAIN_NAME="$2"
if [ -z "$DOMAIN_NAME" ]; then
    if [ -f ".env" ]; then
        source .env
    fi
    
    if [ -z "$DOMAIN_NAME" ]; then
        echo -n "Enter DMZ server domain (e.g., data.company.com): "
        read -r DOMAIN_NAME
    fi
fi

if [ -z "$DOMAIN_NAME" ]; then
    echo -e "${RED}✗${NC} Domain name is required"
    exit 1
fi

echo -e "${BLUE}Device ID:${NC} $DEVICE_ID"
echo -e "${BLUE}Server:${NC} $DOMAIN_NAME"
echo

# Create bundle directory
BUNDLE_NAME="fieldstream-${DEVICE_ID}-$(date +%Y%m%d)"
BUNDLE_DIR="deployments/$BUNDLE_NAME"

echo "Creating FieldStream bundle: $BUNDLE_NAME"

# Clean up old bundle if exists
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Copy field client code
echo "📦 Copying field client..."
cp -r field-client/* "$BUNDLE_DIR/"

# Create certificates directory in bundle
mkdir -p "$BUNDLE_DIR/certs"

# Copy necessary certificates
echo "🔐 Copying certificates..."
cp certs/ca.crt "$BUNDLE_DIR/certs/"

# Copy device-specific certificate or create new one
if [ -f "certs/${DEVICE_ID}.crt" ]; then
    echo "Using existing certificate for $DEVICE_ID"
    cp "certs/${DEVICE_ID}.crt" "$BUNDLE_DIR/certs/"
    cp "certs/${DEVICE_ID}.key" "$BUNDLE_DIR/certs/"
else
    echo "Generating new certificate for $DEVICE_ID"
    
    # Generate device certificate
    openssl genrsa -out "$BUNDLE_DIR/certs/${DEVICE_ID}.key" 2048
    openssl req -new -key "$BUNDLE_DIR/certs/${DEVICE_ID}.key" \
        -out "$BUNDLE_DIR/certs/${DEVICE_ID}.csr" \
        -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=IoT Devices/CN=${DEVICE_ID}"
    
    openssl x509 -req -in "$BUNDLE_DIR/certs/${DEVICE_ID}.csr" \
        -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial \
        -out "$BUNDLE_DIR/certs/${DEVICE_ID}.crt" -days 365
    
    # Clean up
    rm "$BUNDLE_DIR/certs/${DEVICE_ID}.csr"
    
    # Also save to main certs directory
    cp "$BUNDLE_DIR/certs/${DEVICE_ID}.crt" "certs/"
    cp "$BUNDLE_DIR/certs/${DEVICE_ID}.key" "certs/"
fi

# Create device-specific .env file
echo "⚙️  Creating configuration..."
cat > "$BUNDLE_DIR/.env" << EOF
# Field Device Configuration - $DEVICE_ID
# Generated: $(date)

# Device identification
DEVICE_ID=$DEVICE_ID
DOMAIN_NAME=$DOMAIN_NAME
SERVER_URL=wss://$DOMAIN_NAME/ws

# Certificate paths
CERT_PATH=/certs

# Data transmission settings
DATA_SEND_INTERVAL=5000
MAX_RETRY_ATTEMPTS=10
RETRY_BACKOFF_MS=1000

# Device metadata (customize as needed)
DEVICE_TYPE=sensor
DEVICE_LOCATION=field-site
DEVICE_MODEL=process-monitor
RESEARCHER_NAME=researcher.name

# Logging
LOG_LEVEL=info
EOF

# Copy utility scripts
echo "🛠️  Copying utility scripts..."
mkdir -p "$BUNDLE_DIR/scripts"

# Copy relevant scripts with relative paths fixed
cat > "$BUNDLE_DIR/test-connection.sh" << 'EOF'
#!/bin/bash
# Connection test script for field deployment

# This script is included in the field deployment bundle
# It tests connectivity and validates configuration

source ../scripts/test-connection.sh
EOF

cat > "$BUNDLE_DIR/status.sh" << 'EOF'
#!/bin/bash
# Status dashboard for field deployment

source ../scripts/status.sh
EOF

cat > "$BUNDLE_DIR/send-test-data.sh" << 'EOF'
#!/bin/bash
# Send test data script

source ../scripts/send-test-data.sh
EOF

cat > "$BUNDLE_DIR/diagnose.sh" << 'EOF'
#!/bin/bash
# Diagnostic script

source ../scripts/diagnose.sh
EOF

# Make scripts executable
chmod +x "$BUNDLE_DIR"/*.sh

# Create simplified deployment script
cat > "$BUNDLE_DIR/deploy.sh" << 'EOF'
#!/bin/bash
# Simple deployment script for researchers

echo "=== Field Device Deployment ==="
echo "Device ID: $DEVICE_ID"
echo "Server: $DOMAIN_NAME"
echo

# Test connection first
if ./test-connection.sh; then
    echo "✓ Connection test passed"
else
    echo "✗ Connection test failed - check configuration"
    exit 1
fi

# Deploy
echo "Starting field client..."
docker-compose up --build -d

echo "✓ Deployment complete!"
echo
echo "Monitor with: ./status.sh"
echo "Send test data: ./send-test-data.sh"
EOF

chmod +x "$BUNDLE_DIR/deploy.sh"

# Create README for the bundle
cat > "$BUNDLE_DIR/README.md" << EOF
# Field Device Deployment Bundle

**Device ID:** $DEVICE_ID  
**Server:** $DOMAIN_NAME  
**Generated:** $(date)

## Quick Start

1. **Test connection:**
   \`\`\`bash
   ./test-connection.sh
   \`\`\`

2. **Deploy field client:**
   \`\`\`bash
   ./deploy.sh
   \`\`\`

3. **Monitor status:**
   \`\`\`bash
   ./status.sh
   \`\`\`

4. **Send test data:**
   \`\`\`bash
   ./send-test-data.sh
   \`\`\`

## Configuration

Edit \`.env\` to customize:
- Device location and researcher information
- Data transmission frequency
- Logging levels

## Troubleshooting

- **Connection issues:** Run \`./diagnose.sh\`
- **Certificate problems:** Check \`certs/\` directory
- **Container issues:** Check Docker is running

## Support

If you need help, run \`./diagnose.sh\` and send the generated report to IT support.

---
*This bundle contains security certificates - keep secure and do not share*
EOF

# Copy real script implementations
cp scripts/test-connection.sh "$BUNDLE_DIR/"
cp scripts/status.sh "$BUNDLE_DIR/"
cp scripts/send-test-data.sh "$BUNDLE_DIR/"
cp scripts/diagnose.sh "$BUNDLE_DIR/"

# Create archive
echo "📦 Creating archive..."
cd deployments/
tar -czf "${BUNDLE_NAME}.tar.gz" "$BUNDLE_NAME/"
zip -r "${BUNDLE_NAME}.zip" "$BUNDLE_NAME/" > /dev/null 2>&1 || echo "zip not available - only tar.gz created"

echo
echo -e "${GREEN}✓ Bundle created successfully!${NC}"
echo
echo "Bundle location: deployments/$BUNDLE_NAME/"
echo "Archive: deployments/${BUNDLE_NAME}.tar.gz"
echo

# Show what's included
echo "Bundle contents:"
ls -la "$BUNDLE_NAME/"
echo

echo "🚀 Deployment instructions:"
echo "1. Transfer ${BUNDLE_NAME}.tar.gz to field device"
echo "2. Extract: tar -xzf ${BUNDLE_NAME}.tar.gz"
echo "3. Run: cd $BUNDLE_NAME && ./deploy.sh"
echo
echo -e "${BLUE}Note:${NC} This bundle contains security certificates - handle securely"

# Create deployment log
echo "$(date): Created bundle for device $DEVICE_ID connecting to $DOMAIN_NAME" >> deployments/deployment.log