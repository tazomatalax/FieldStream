#!/bin/bash
# Comprehensive diagnostic script for troubleshooting

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "================================================================"
echo "                  FIELDSTREAM DIAGNOSTICS"
echo "================================================================"
echo

# Create diagnostics report
REPORT_FILE="diagnostics-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee "$REPORT_FILE")
exec 2>&1

echo "Diagnostic report started at: $(date)"
echo "Report will be saved as: $REPORT_FILE"
echo

# Load environment
if [ -f ".env" ]; then
    source .env
    echo -e "${GREEN}✓${NC} Environment configuration loaded"
else
    echo -e "${RED}✗${NC} No .env file found"
    exit 1
fi

echo
echo "=== SYSTEM INFORMATION ==="
echo "OS: $(uname -s) $(uname -r)"
echo "Architecture: $(uname -m)"
echo "Hostname: $(hostname)"
echo "User: $(whoami)"
echo "Working Directory: $(pwd)"
echo "Date: $(date)"
echo

echo "=== CONFIGURATION ==="
echo "Device ID: ${DEVICE_ID:-'NOT SET'}"
echo "Domain Name: ${DOMAIN_NAME:-'NOT SET'}"
echo "Server URL: ${SERVER_URL:-'NOT SET'}"
echo "Device Location: ${DEVICE_LOCATION:-'Not specified'}"
echo "Researcher: ${RESEARCHER_NAME:-'Not specified'}"
echo

echo "=== NETWORK CONNECTIVITY ==="

# Basic connectivity
echo -n "Internet connectivity (google.com): "
if ping -c 1 -W 5 google.com &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
fi

echo -n "DNS resolution (google.com): "
if nslookup google.com &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
fi

# Target server connectivity
if [ -n "$DOMAIN_NAME" ]; then
    echo -n "DNS resolution ($DOMAIN_NAME): "
    if nslookup "$DOMAIN_NAME" &> /dev/null; then
        echo -e "${GREEN}OK${NC}"
        
        # Get IP address
        SERVER_IP=$(nslookup "$DOMAIN_NAME" | grep 'Address:' | tail -1 | cut -d' ' -f2)
        echo "Server IP: $SERVER_IP"
    else
        echo -e "${RED}FAILED${NC}"
    fi
    
    echo -n "HTTPS connectivity ($DOMAIN_NAME:443): "
    if timeout 10 bash -c "</dev/tcp/$DOMAIN_NAME/443" &> /dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
    
    echo -n "HTTP connectivity ($DOMAIN_NAME:80): "
    if timeout 10 bash -c "</dev/tcp/$DOMAIN_NAME/80" &> /dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
fi

# Network interface information
echo
echo "Network interfaces:"
ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "Cannot get network interface info"

echo
echo "Routing table:"
ip route 2>/dev/null || route -n 2>/dev/null || echo "Cannot get routing info"

echo
echo "=== DNS CONFIGURATION ==="
echo "DNS servers:"
cat /etc/resolv.conf 2>/dev/null || echo "Cannot read /etc/resolv.conf"

echo
echo "=== DOCKER ENVIRONMENT ==="

echo -n "Docker installed: "
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}OK${NC} ($DOCKER_VERSION)"
else
    echo -e "${RED}NOT FOUND${NC}"
fi

echo -n "Docker daemon running: "
if docker info &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}NOT RUNNING${NC}"
fi

echo -n "Docker Compose available: "
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version)
    echo -e "${GREEN}OK${NC} ($COMPOSE_VERSION)"
else
    echo -e "${RED}NOT FOUND${NC}"
fi

# Docker system info
echo
echo "Docker system information:"
docker system info 2>/dev/null || echo "Cannot get Docker system info"

echo
echo "=== CERTIFICATE VERIFICATION ==="

if [ -d "certs" ]; then
    echo "Certificate files found:"
    ls -la certs/
    
    echo
    if [ -f "certs/ca.crt" ]; then
        echo "CA Certificate details:"
        openssl x509 -in certs/ca.crt -noout -subject -issuer -dates 2>/dev/null || echo "Cannot read CA certificate"
    fi
    
    if [ -f "certs/${DEVICE_ID}.crt" ]; then
        echo
        echo "Device Certificate details:"
        openssl x509 -in "certs/${DEVICE_ID}.crt" -noout -subject -issuer -dates 2>/dev/null || echo "Cannot read device certificate"
    elif [ -f "certs/field-device-001.crt" ]; then
        echo
        echo "Default Device Certificate details:"
        openssl x509 -in "certs/field-device-001.crt" -noout -subject -issuer -dates 2>/dev/null || echo "Cannot read device certificate"
    fi
else
    echo -e "${RED}Certificate directory not found${NC}"
fi

echo
echo "=== CONTAINER STATUS ==="

# Check if in field-client directory
if [ -f "docker-compose.yml" ]; then
    COMPOSE_DIR="."
elif [ -f "field-client/docker-compose.yml" ]; then
    COMPOSE_DIR="field-client"
else
    echo "No docker-compose.yml found"
    COMPOSE_DIR=""
fi

if [ -n "$COMPOSE_DIR" ]; then
    cd "$COMPOSE_DIR"
    
    echo "Docker Compose configuration:"
    docker-compose config 2>/dev/null || echo "Cannot validate docker-compose.yml"
    
    echo
    echo "Container status:"
    docker-compose ps 2>/dev/null || echo "Cannot get container status"
    
    echo
    echo "Recent logs (last 50 lines):"
    docker-compose logs --tail=50 2>/dev/null || echo "Cannot get container logs"
else
    echo "No docker-compose.yml found in current directory or field-client/"
fi

echo
echo "=== SYSTEM RESOURCES ==="

echo "Disk usage:"
df -h . 2>/dev/null || echo "Cannot get disk usage"

echo
echo "Memory usage:"
free -h 2>/dev/null || echo "Cannot get memory usage"

echo
echo "CPU information:"
cat /proc/cpuinfo | grep "model name" | head -1 2>/dev/null || echo "Cannot get CPU info"

echo
echo "Load average:"
uptime 2>/dev/null || echo "Cannot get load average"

echo
echo "=== FIREWALL STATUS ==="
echo "iptables rules:"
sudo iptables -L 2>/dev/null || echo "Cannot read iptables (may need sudo)"

echo
echo "UFW status:"
sudo ufw status 2>/dev/null || echo "UFW not available or no sudo access"

echo
echo "=== PROCESS INFORMATION ==="
echo "Docker processes:"
ps aux | grep docker | grep -v grep || echo "No Docker processes found"

echo
echo "=== RECENT SYSTEM LOGS ==="
echo "Last 20 system log entries:"
journalctl -n 20 --no-pager 2>/dev/null || dmesg | tail -20 2>/dev/null || echo "Cannot access system logs"

echo
echo "================================================================"
echo "                    DIAGNOSTIC SUMMARY"
echo "================================================================"

# Summary checks
ISSUES=0

echo -n "Configuration: "
if [ -n "$DEVICE_ID" ] && [ -n "$DOMAIN_NAME" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}Issues found${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo -n "Certificates: "
if [ -f "certs/ca.crt" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}Missing${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo -n "Docker: "
if docker info &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}Issues${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo -n "Network: "
if ping -c 1 -W 5 google.com &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}Issues${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo
if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}✓ No critical issues found${NC}"
else
    echo -e "${YELLOW}⚠ Found $ISSUES potential issues${NC}"
fi

echo
echo "Full diagnostic report saved to: $REPORT_FILE"
echo "Send this file to IT support if you need help."