#!/bin/bash
# Connection Test Script for Researchers

set -e

echo "=== FieldStream Connection Test ==="
echo "Testing connectivity and configuration..."
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test functions
test_passed() {
    echo -e "${GREEN}✓${NC} $1"
}

test_failed() {
    echo -e "${RED}✗${NC} $1"
}

test_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Load environment if exists
if [ -f ".env" ]; then
    source .env
else
    test_failed "No .env file found. Copy .env.example to .env and configure it."
    exit 1
fi

echo "1. Testing basic connectivity..."

# Test internet connectivity
if ping -c 1 google.com &> /dev/null; then
    test_passed "Internet connectivity"
else
    test_failed "No internet connectivity"
    echo "  → Check network connection and try again"
    exit 1
fi

# Test DNS resolution for target server
if [ -n "$DOMAIN_NAME" ]; then
    if nslookup "$DOMAIN_NAME" &> /dev/null; then
        test_passed "DNS resolution for $DOMAIN_NAME"
    else
        test_failed "Cannot resolve $DOMAIN_NAME"
        echo "  → Check domain name in .env file"
        exit 1
    fi
else
    test_failed "DOMAIN_NAME not set in .env file"
    exit 1
fi

echo
echo "2. Testing server connectivity..."

# Test HTTPS connectivity to server
if command -v curl &> /dev/null; then
    if curl -s --connect-timeout 10 "https://$DOMAIN_NAME" > /dev/null; then
        test_passed "HTTPS connection to $DOMAIN_NAME"
    else
        test_failed "Cannot connect to https://$DOMAIN_NAME"
        echo "  → Check if server is running and accessible"
        echo "  → Verify domain name with IT department"
        exit 1
    fi
else
    test_warning "curl not available - skipping HTTPS test"
fi

# Test WebSocket endpoint
if command -v curl &> /dev/null; then
    # Test if WebSocket endpoint responds
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null "https://$DOMAIN_NAME/ws" || echo "000")
    if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "426" ]; then
        test_passed "WebSocket endpoint available (HTTP $HTTP_CODE is expected)"
    else
        test_warning "Unexpected response from WebSocket endpoint (HTTP $HTTP_CODE)"
        echo "  → This may still work - WebSocket upgrades often return 400"
    fi
fi

echo
echo "3. Testing configuration..."

# Check device ID
if [ -n "$DEVICE_ID" ]; then
    test_passed "Device ID set: $DEVICE_ID"
else
    test_failed "DEVICE_ID not set in .env file"
    exit 1
fi

# Check for unique device ID
if [ "$DEVICE_ID" = "field-device-001" ]; then
    test_warning "Using default device ID - consider setting a unique name"
    echo "  → Example: DEVICE_ID=process-greenhouse-01"
fi

# Check certificate directory
if [ -d "certs" ]; then
    CERT_COUNT=$(ls certs/ | wc -l)
    if [ "$CERT_COUNT" -gt 0 ]; then
        test_passed "Certificate directory found ($CERT_COUNT files)"
    else
        test_failed "Certificate directory is empty"
        echo "  → Contact IT for certificate bundle"
        exit 1
    fi
else
    test_failed "Certificate directory not found"
    echo "  → Extract certificate bundle to certs/ directory"
    exit 1
fi

# Check specific certificate files
if [ -f "certs/ca.crt" ]; then
    test_passed "Root CA certificate found"
else
    test_failed "Root CA certificate missing (certs/ca.crt)"
fi

# Check for device certificate
if [ -f "certs/${DEVICE_ID}.crt" ] || [ -f "certs/field-device-001.crt" ]; then
    test_passed "Device certificate found"
else
    test_warning "Device-specific certificate not found - will use default"
fi

echo
echo "4. Testing Docker environment..."

# Check Docker
if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
        test_passed "Docker running (version $DOCKER_VERSION)"
    else
        test_failed "Docker daemon not running"
        echo "  → Start Docker: sudo systemctl start docker"
        exit 1
    fi
else
    test_failed "Docker not installed"
    echo "  → Install Docker and try again"
    exit 1
fi

# Check Docker Compose
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version | cut -d' ' -f3 | tr -d ',')
    test_passed "Docker Compose available (version $COMPOSE_VERSION)"
else
    test_failed "Docker Compose not installed"
    echo "  → Install docker-compose and try again"
    exit 1
fi

echo
echo "5. Certificate validation..."

# Check certificate expiry
if command -v openssl &> /dev/null && [ -f "certs/ca.crt" ]; then
    EXPIRY=$(openssl x509 -in certs/ca.crt -noout -enddate | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null || echo "0")
    CURRENT_EPOCH=$(date +%s)
    
    if [ "$EXPIRY_EPOCH" -gt "$CURRENT_EPOCH" ]; then
        DAYS_LEFT=$(( (EXPIRY_EPOCH - CURRENT_EPOCH) / 86400 ))
        test_passed "Certificates valid (expires in $DAYS_LEFT days)"
        
        if [ "$DAYS_LEFT" -lt 30 ]; then
            test_warning "Certificates expire soon - contact IT for renewal"
        fi
    else
        test_failed "Certificates have expired"
        echo "  → Contact IT for renewed certificate bundle"
        exit 1
    fi
else
    test_warning "Cannot validate certificate expiry"
fi

echo
echo "6. Port and firewall check..."

# Check if any local services might conflict
if ss -tulpn 2>/dev/null | grep -q ":8080\|:8883"; then
    test_warning "Port 8080 or 8883 already in use"
    echo "  → Field client may fail to start"
    echo "  → Stop conflicting services or change ports"
fi

echo
echo "=== Test Summary ==="

# Network connectivity test using nc if available
if command -v nc &> /dev/null; then
    echo "Testing outbound connections..."
    if timeout 5 nc -z "$DOMAIN_NAME" 443 2>/dev/null; then
        test_passed "Outbound HTTPS (443) connectivity"
    else
        test_warning "Outbound HTTPS (443) may be blocked"
    fi
    
    if timeout 5 nc -z "$DOMAIN_NAME" 80 2>/dev/null; then
        test_passed "Outbound HTTP (80) connectivity"
    else
        test_warning "Outbound HTTP (80) may be blocked"
    fi
fi

echo
echo -e "${GREEN}✓ Connection test completed successfully!${NC}"
echo
echo "Next steps:"
echo "1. Deploy field client: ./deploy-field-device.sh"
echo "2. Monitor status: ./status.sh"
echo "3. Send test data: ./send-test-data.sh"
echo
echo "If you see any warnings above, the system may still work"
echo "but you should address them for optimal performance."