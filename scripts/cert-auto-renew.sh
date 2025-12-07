#!/bin/bash
# ============================================================
# FieldStream Certificate Auto-Renewal Service
# ============================================================
# Run this script via cron to automatically renew expiring certificates
# 
# Example crontab entry (daily at 2 AM):
# 0 2 * * * /path/to/scripts/cert-auto-renew.sh >> /var/log/fieldstream-cert-renewal.log 2>&1
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_MANAGER="${SCRIPT_DIR}/cert-manager.sh"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CERT_DIR="${PROJECT_ROOT}/certs"

# Slack/webhook notification (optional)
WEBHOOK_URL="${CERT_RENEWAL_WEBHOOK_URL:-}"

# Email notification (optional)
NOTIFY_EMAIL="${CERT_RENEWAL_EMAIL:-}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

notify() {
    local message="$1"
    local level="${2:-info}"
    
    log "$message"
    
    # Send to webhook if configured
    if [ -n "$WEBHOOK_URL" ]; then
        curl -s -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"text\": \"[FieldStream Certs] ${message}\", \"level\": \"${level}\"}" \
            >/dev/null 2>&1 || true
    fi
    
    # Send email if configured
    if [ -n "$NOTIFY_EMAIL" ]; then
        echo "$message" | mail -s "[FieldStream] Certificate ${level}" "$NOTIFY_EMAIL" 2>/dev/null || true
    fi
}

# Check if cert-manager exists
if [ ! -x "$CERT_MANAGER" ]; then
    notify "ERROR: cert-manager.sh not found or not executable" "error"
    exit 1
fi

log "Starting certificate auto-renewal check..."

# Export cert directory for cert-manager
export CERT_DIR

# Check certificates and capture output
check_output=$("$CERT_MANAGER" check 2>&1) || true
echo "$check_output"

# Check if any certificates need renewal
if echo "$check_output" | grep -q "Expiring soon\|EXPIRED"; then
    notify "Certificates need renewal - initiating auto-renewal" "warning"
    
    # Run auto-renewal
    renewal_output=$("$CERT_MANAGER" auto-renew 2>&1) || {
        notify "Certificate renewal FAILED: $renewal_output" "error"
        exit 1
    }
    
    echo "$renewal_output"
    
    # Check if services need restart
    if echo "$renewal_output" | grep -q "Certificate renewed"; then
        notify "Certificates renewed successfully. Services may need restart." "success"
        
        # Optionally restart services (uncomment if needed)
        # log "Restarting services..."
        # cd "$PROJECT_ROOT/dmz" && docker-compose restart mqtt-broker websocket-server
        # cd "$PROJECT_ROOT/internal-network" && docker-compose restart internal-mqtt-broker
        
        # Generate updated CRL
        "$CERT_MANAGER" crl
    fi
else
    log "All certificates are valid. No renewal needed."
fi

log "Certificate auto-renewal check completed."
