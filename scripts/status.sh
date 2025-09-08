#!/bin/bash
# Field Device Status Dashboard

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

status_good() {
    echo -e "${GREEN}●${NC} $1"
}

status_warning() {
    echo -e "${YELLOW}●${NC} $1"
}

status_error() {
    echo -e "${RED}●${NC} $1"
}

status_info() {
    echo -e "${BLUE}●${NC} $1"
}

clear
echo "======================================================"
echo "              FIELDSTREAM STATUS DASHBOARD"
echo "======================================================"
echo

# Load environment
if [ -f ".env" ]; then
    source .env
else
    status_error "No .env configuration found"
    exit 1
fi

# Check if we're in field-client directory
if [ ! -f "docker-compose.yml" ]; then
    if [ -d "field-client" ]; then
        cd field-client/
    else
        echo "Run this from field-client directory or project root"
        exit 1
    fi
fi

# Device Information
echo "📱 DEVICE INFORMATION"
echo "────────────────────────────────────────────────────"
status_info "Device ID: ${DEVICE_ID:-'Not set'}"
status_info "Target Server: ${DOMAIN_NAME:-'Not set'}"
status_info "Location: ${DEVICE_LOCATION:-'Not specified'}"
status_info "Researcher: ${RESEARCHER_NAME:-'Not specified'}"
echo

# Container Status
echo "🐳 CONTAINER STATUS"
echo "────────────────────────────────────────────────────"
if docker-compose ps | grep -q "Up"; then
    CONTAINER_STATUS=$(docker-compose ps --format "table {{.Name}}\t{{.State}}\t{{.Ports}}")
    status_good "FieldStream client is running"
    echo "$CONTAINER_STATUS" | tail -n +2
    
    # Get uptime
    STARTED=$(docker inspect --format='{{.State.StartedAt}}' field-client 2>/dev/null | cut -d'T' -f1)
    if [ -n "$STARTED" ]; then
        status_info "Started: $STARTED"
    fi
else
    status_error "FieldStream client is not running"
    echo "   Start with: docker-compose up -d"
fi
echo

# Connection Status
echo "🌐 CONNECTION STATUS"  
echo "────────────────────────────────────────────────────"

# Check internet connectivity
if ping -c 1 -W 3 google.com &> /dev/null; then
    status_good "Internet connectivity"
else
    status_error "No internet connection"
fi

# Check server connectivity
if [ -n "$DOMAIN_NAME" ] && curl -s --connect-timeout 5 "https://$DOMAIN_NAME" > /dev/null; then
    status_good "Server reachable: $DOMAIN_NAME"
else
    status_error "Cannot reach server: $DOMAIN_NAME"
fi

# Check WebSocket connection status from logs
if docker-compose ps -q | xargs docker logs 2>/dev/null | grep -q "Connection established"; then
    status_good "WebSocket connected"
    
    # Get last activity
    LAST_ACTIVITY=$(docker-compose ps -q | xargs docker logs --tail=100 2>/dev/null | grep "Sent data" | tail -1 | cut -d' ' -f1-2)
    if [ -n "$LAST_ACTIVITY" ]; then
        status_info "Last data sent: $LAST_ACTIVITY"
    fi
else
    status_warning "WebSocket connection status unknown"
fi
echo

# Data Transmission Stats
echo "📊 DATA TRANSMISSION"
echo "────────────────────────────────────────────────────"

if docker-compose ps -q &> /dev/null; then
    # Count messages sent today
    MESSAGES_TODAY=$(docker-compose logs --since="24h" 2>/dev/null | grep -c "Sent data" || echo "0")
    status_info "Messages sent today: $MESSAGES_TODAY"
    
    # Count errors
    ERRORS_TODAY=$(docker-compose logs --since="24h" 2>/dev/null | grep -c "error\|Error\|ERROR" || echo "0")
    if [ "$ERRORS_TODAY" -eq "0" ]; then
        status_good "No errors in last 24h"
    else
        status_warning "Errors in last 24h: $ERRORS_TODAY"
    fi
    
    # Show last few messages
    echo
    echo "Recent activity (last 5 messages):"
    docker-compose logs --tail=100 2>/dev/null | grep "Sent data\|Connection\|error" | tail -5 | while read line; do
        echo "   $line"
    done
else
    status_error "Cannot access container logs"
fi
echo

# System Resources
echo "⚡ SYSTEM RESOURCES"
echo "────────────────────────────────────────────────────"

# Disk space
DISK_USAGE=$(df -h . | awk 'NR==2{printf "%s", $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 90 ]; then
    status_good "Disk usage: ${DISK_USAGE}%"
else
    status_warning "Disk usage high: ${DISK_USAGE}%"
fi

# Memory usage (if available)
if command -v free &> /dev/null; then
    MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
    if [ "$MEM_USAGE" -lt 80 ]; then
        status_good "Memory usage: ${MEM_USAGE}%"
    else
        status_warning "Memory usage high: ${MEM_USAGE}%"
    fi
fi

# Container resource usage
if docker stats --no-stream field-client &> /dev/null; then
    CONTAINER_CPU=$(docker stats --no-stream --format "table {{.CPUPerc}}" field-client 2>/dev/null | tail -1)
    CONTAINER_MEM=$(docker stats --no-stream --format "table {{.MemUsage}}" field-client 2>/dev/null | tail -1)
    status_info "Container CPU: $CONTAINER_CPU"
    status_info "Container Memory: $CONTAINER_MEM"
fi
echo

# Network Information
echo "🔗 NETWORK INFORMATION"
echo "────────────────────────────────────────────────────"

# Get IP address
LOCAL_IP=$(hostname -I | awk '{print $1}' || echo "Unknown")
status_info "Local IP: $LOCAL_IP"

# Check if using cellular/mobile connection
if iwconfig 2>/dev/null | grep -q "ESSID"; then
    WIFI_SSID=$(iwconfig 2>/dev/null | grep ESSID | head -1 | cut -d'"' -f2)
    status_info "WiFi Network: $WIFI_SSID"
fi

# Data usage (if available)
if [ -f "/proc/net/dev" ]; then
    RX_BYTES=$(cat /proc/net/dev | grep -E "(eth0|wlan0)" | awk '{print $2}' | head -1)
    TX_BYTES=$(cat /proc/net/dev | grep -E "(eth0|wlan0)" | awk '{print $10}' | head -1)
    if [ -n "$RX_BYTES" ] && [ -n "$TX_BYTES" ]; then
        RX_MB=$((RX_BYTES / 1024 / 1024))
        TX_MB=$((TX_BYTES / 1024 / 1024))
        status_info "Data usage: ${TX_MB}MB sent, ${RX_MB}MB received"
    fi
fi
echo

# Quick Actions
echo "🛠️  QUICK ACTIONS"
echo "────────────────────────────────────────────────────"
echo "  Restart client:     docker-compose restart"
echo "  View live logs:     docker-compose logs -f"
echo "  Send test data:     ./send-test-data.sh"
echo "  Update client:      ./update.sh"
echo "  Stop client:        docker-compose down"
echo

# Auto-refresh option
echo "────────────────────────────────────────────────────"
echo "Status refreshed at: $(date)"
echo "Press Ctrl+C to exit, or run 'watch -n 30 ./status.sh' for auto-refresh"