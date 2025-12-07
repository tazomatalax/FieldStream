#!/bin/bash
# ============================================================
# FieldStream Certificate Lifecycle Management
# ============================================================
# This script provides automated certificate management including:
# - Initial CA and certificate generation
# - Certificate renewal before expiry
# - Certificate revocation
# - CRL (Certificate Revocation List) generation
# ============================================================

set -e

# Configuration
CERT_DIR="${CERT_DIR:-./certs}"
CA_DAYS="${CA_DAYS:-3650}"       # 10 years for CA
SERVER_DAYS="${SERVER_DAYS:-365}" # 1 year for server certs
CLIENT_DAYS="${CLIENT_DAYS:-90}"  # 90 days for device certs
RENEWAL_THRESHOLD_DAYS="${RENEWAL_THRESHOLD_DAYS:-30}" # Renew when < 30 days remaining

# CRL Configuration
CRL_DIR="${CERT_DIR}/crl"
INDEX_FILE="${CERT_DIR}/index.txt"
SERIAL_FILE="${CERT_DIR}/serial"
CRL_NUMBER_FILE="${CERT_DIR}/crlnumber"
OPENSSL_CNF="${CERT_DIR}/openssl.cnf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Initialize CA infrastructure
init_ca_infrastructure() {
    log_info "Initializing CA infrastructure..."
    
    mkdir -p "${CERT_DIR}" "${CRL_DIR}"
    
    # Create index file for tracking issued certificates
    if [ ! -f "${INDEX_FILE}" ]; then
        touch "${INDEX_FILE}"
    fi
    
    # Create serial number file
    if [ ! -f "${SERIAL_FILE}" ]; then
        echo "1000" > "${SERIAL_FILE}"
    fi
    
    # Create CRL number file
    if [ ! -f "${CRL_NUMBER_FILE}" ]; then
        echo "01" > "${CRL_NUMBER_FILE}"
    fi
    
    # Create OpenSSL config for CA operations
    cat > "${OPENSSL_CNF}" << EOF
[ ca ]
default_ca = CA_default

[ CA_default ]
dir               = ${CERT_DIR}
certs             = \$dir
crl_dir           = \$dir/crl
database          = \$dir/index.txt
new_certs_dir     = \$dir
serial            = \$dir/serial
crlnumber         = \$dir/crlnumber
crl               = \$dir/crl/ca.crl
private_key       = \$dir/ca.key
certificate       = \$dir/ca.crt
default_days      = 365
default_crl_days  = 30
default_md        = sha256
preserve          = no
policy            = policy_loose

[ policy_loose ]
countryName             = optional
stateOrProvinceName     = optional
localityName            = optional
organizationName        = optional
organizationalUnitName  = optional
commonName              = supplied
emailAddress            = optional

[ req ]
default_bits        = 2048
distinguished_name  = req_distinguished_name
string_mask         = utf8only
default_md          = sha256

[ req_distinguished_name ]
countryName                     = Country Name (2 letter code)
stateOrProvinceName             = State or Province Name
localityName                    = Locality Name
0.organizationName              = Organization Name
organizationalUnitName          = Organizational Unit Name
commonName                      = Common Name

[ v3_ca ]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign

[ server_cert ]
basicConstraints = CA:FALSE
nsCertType = server
nsComment = "OpenSSL Generated Server Certificate"
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer:always
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ client_cert ]
basicConstraints = CA:FALSE
nsCertType = client
nsComment = "OpenSSL Generated Client Certificate"
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer:always
keyUsage = critical, nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
    
    log_info "CA infrastructure initialized"
}

# Generate root CA
generate_ca() {
    if [ -f "${CERT_DIR}/ca.key" ] && [ -f "${CERT_DIR}/ca.crt" ]; then
        log_warn "CA already exists. Use 'rotate-ca' to regenerate."
        return 0
    fi
    
    log_info "Generating Certificate Authority..."
    
    openssl genrsa -out "${CERT_DIR}/ca.key" 4096
    chmod 400 "${CERT_DIR}/ca.key"
    
    openssl req -new -x509 -days ${CA_DAYS} \
        -key "${CERT_DIR}/ca.key" \
        -out "${CERT_DIR}/ca.crt" \
        -config "${OPENSSL_CNF}" \
        -extensions v3_ca \
        -subj "/C=US/ST=CA/L=Enterprise/O=FieldStream/OU=IoT Infrastructure/CN=FieldStream Root CA"
    
    log_info "CA certificate generated: ${CERT_DIR}/ca.crt"
    
    # Generate initial CRL
    generate_crl
}

# Generate server certificate
generate_server_cert() {
    local name=$1
    local cn=$2
    local san=$3
    
    if [ -z "$name" ] || [ -z "$cn" ]; then
        log_error "Usage: generate_server_cert <name> <common_name> [san]"
        return 1
    fi
    
    log_info "Generating server certificate for: ${name} (CN=${cn})"
    
    openssl genrsa -out "${CERT_DIR}/${name}.key" 2048
    chmod 400 "${CERT_DIR}/${name}.key"
    
    # Create CSR
    openssl req -new \
        -key "${CERT_DIR}/${name}.key" \
        -out "${CERT_DIR}/${name}.csr" \
        -subj "/C=US/ST=CA/L=Enterprise/O=FieldStream/OU=Services/CN=${cn}"
    
    # Sign with CA
    if [ -n "$san" ]; then
        openssl x509 -req \
            -in "${CERT_DIR}/${name}.csr" \
            -CA "${CERT_DIR}/ca.crt" \
            -CAkey "${CERT_DIR}/ca.key" \
            -CAserial "${SERIAL_FILE}" \
            -out "${CERT_DIR}/${name}.crt" \
            -days ${SERVER_DAYS} \
            -extfile <(printf "subjectAltName=${san}")
    else
        openssl x509 -req \
            -in "${CERT_DIR}/${name}.csr" \
            -CA "${CERT_DIR}/ca.crt" \
            -CAkey "${CERT_DIR}/ca.key" \
            -CAserial "${SERIAL_FILE}" \
            -out "${CERT_DIR}/${name}.crt" \
            -days ${SERVER_DAYS}
    fi
    
    rm "${CERT_DIR}/${name}.csr"
    
    # Update index
    echo "V $(date -u +%y%m%d%H%M%SZ) $(cat ${SERIAL_FILE}) unknown /CN=${cn}" >> "${INDEX_FILE}"
    
    log_info "Server certificate generated: ${CERT_DIR}/${name}.crt"
}

# Generate client certificate
generate_client_cert() {
    local name=$1
    local cn=${2:-$name}
    
    if [ -z "$name" ]; then
        log_error "Usage: generate_client_cert <name> [common_name]"
        return 1
    fi
    
    log_info "Generating client certificate for: ${name} (CN=${cn})"
    
    openssl genrsa -out "${CERT_DIR}/${name}.key" 2048
    chmod 400 "${CERT_DIR}/${name}.key"
    
    openssl req -new \
        -key "${CERT_DIR}/${name}.key" \
        -out "${CERT_DIR}/${name}.csr" \
        -subj "/C=US/ST=CA/L=Enterprise/O=FieldStream/OU=Devices/CN=${cn}"
    
    openssl x509 -req \
        -in "${CERT_DIR}/${name}.csr" \
        -CA "${CERT_DIR}/ca.crt" \
        -CAkey "${CERT_DIR}/ca.key" \
        -CAserial "${SERIAL_FILE}" \
        -out "${CERT_DIR}/${name}.crt" \
        -days ${CLIENT_DAYS}
    
    rm "${CERT_DIR}/${name}.csr"
    
    # Update index
    echo "V $(date -u +%y%m%d%H%M%SZ) $(cat ${SERIAL_FILE}) unknown /CN=${cn}" >> "${INDEX_FILE}"
    
    log_info "Client certificate generated: ${CERT_DIR}/${name}.crt"
}

# Check certificate expiry
check_expiry() {
    local cert_file=$1
    
    if [ ! -f "$cert_file" ]; then
        log_error "Certificate not found: $cert_file"
        return 1
    fi
    
    local expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" | cut -d= -f2)
    local expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry_date" +%s)
    local now_epoch=$(date +%s)
    local days_remaining=$(( (expiry_epoch - now_epoch) / 86400 ))
    
    local cert_name=$(basename "$cert_file")
    
    if [ $days_remaining -lt 0 ]; then
        log_error "${cert_name}: EXPIRED (${days_remaining} days ago)"
        return 2
    elif [ $days_remaining -lt $RENEWAL_THRESHOLD_DAYS ]; then
        log_warn "${cert_name}: Expiring soon (${days_remaining} days remaining)"
        return 1
    else
        log_info "${cert_name}: Valid (${days_remaining} days remaining)"
        return 0
    fi
}

# Check all certificates
check_all_certs() {
    log_info "Checking certificate expiry..."
    
    local needs_renewal=0
    
    for cert_file in "${CERT_DIR}"/*.crt; do
        if [ -f "$cert_file" ]; then
            check_expiry "$cert_file" || needs_renewal=1
        fi
    done
    
    return $needs_renewal
}

# Renew certificate
renew_cert() {
    local name=$1
    local cert_type=${2:-client}  # client or server
    
    if [ -z "$name" ]; then
        log_error "Usage: renew_cert <name> [client|server]"
        return 1
    fi
    
    local cert_file="${CERT_DIR}/${name}.crt"
    
    if [ ! -f "$cert_file" ]; then
        log_error "Certificate not found: $cert_file"
        return 1
    fi
    
    # Get CN from existing certificate
    local cn=$(openssl x509 -noout -subject -in "$cert_file" | sed -n 's/.*CN=\([^,/]*\).*/\1/p')
    
    log_info "Renewing certificate: ${name} (CN=${cn})"
    
    # Backup old certificate
    mv "${cert_file}" "${cert_file}.old.$(date +%Y%m%d%H%M%S)"
    mv "${CERT_DIR}/${name}.key" "${CERT_DIR}/${name}.key.old.$(date +%Y%m%d%H%M%S)"
    
    # Generate new certificate
    if [ "$cert_type" = "server" ]; then
        generate_server_cert "$name" "$cn"
    else
        generate_client_cert "$name" "$cn"
    fi
    
    log_info "Certificate renewed: ${name}"
}

# Auto-renew expiring certificates
auto_renew() {
    log_info "Checking for certificates needing renewal..."
    
    for cert_file in "${CERT_DIR}"/*.crt; do
        if [ -f "$cert_file" ] && [ "$(basename $cert_file)" != "ca.crt" ]; then
            local name=$(basename "$cert_file" .crt)
            
            if ! check_expiry "$cert_file" >/dev/null 2>&1; then
                local cert_type="client"
                if [[ "$name" == *"server"* ]]; then
                    cert_type="server"
                fi
                renew_cert "$name" "$cert_type"
            fi
        fi
    done
}

# Revoke certificate
revoke_cert() {
    local cert_file=$1
    
    if [ -z "$cert_file" ]; then
        log_error "Usage: revoke_cert <certificate_file>"
        return 1
    fi
    
    if [ ! -f "$cert_file" ]; then
        # Try adding path
        cert_file="${CERT_DIR}/${cert_file}"
        if [ ! -f "$cert_file" ]; then
            log_error "Certificate not found"
            return 1
        fi
    fi
    
    log_info "Revoking certificate: $cert_file"
    
    openssl ca -config "${OPENSSL_CNF}" \
        -revoke "$cert_file" \
        -keyfile "${CERT_DIR}/ca.key" \
        -cert "${CERT_DIR}/ca.crt"
    
    # Regenerate CRL
    generate_crl
    
    log_info "Certificate revoked and CRL updated"
}

# Generate Certificate Revocation List
generate_crl() {
    log_info "Generating Certificate Revocation List..."
    
    openssl ca -config "${OPENSSL_CNF}" \
        -gencrl \
        -keyfile "${CERT_DIR}/ca.key" \
        -cert "${CERT_DIR}/ca.crt" \
        -out "${CRL_DIR}/ca.crl"
    
    # Also generate in PEM format for some applications
    openssl crl -in "${CRL_DIR}/ca.crl" -outform PEM -out "${CRL_DIR}/ca.crl.pem"
    
    log_info "CRL generated: ${CRL_DIR}/ca.crl"
}

# Generate all standard certificates for FieldStream
generate_all() {
    local domain=${1:-"localhost"}
    
    log_info "Generating all FieldStream certificates for domain: ${domain}"
    
    init_ca_infrastructure
    generate_ca
    
    # Server certificates
    generate_server_cert "dmz-server" "${domain}" "DNS:${domain},DNS:localhost,IP:127.0.0.1"
    generate_server_cert "internal-server" "internal-mqtt-broker" "DNS:internal-mqtt-broker,DNS:localhost"
    
    # Service client certificates
    generate_client_cert "dmz-bridge-client" "dmz-bridge-client"
    generate_client_cert "data-distributor" "data-distributor"
    
    # Default device certificate
    generate_client_cert "field-device-001" "field-device-001"
    
    log_info "All certificates generated successfully!"
    log_info "Certificate directory: ${CERT_DIR}"
}

# Create device bundle for deployment
create_device_bundle() {
    local device_id=$1
    local output_dir=${2:-"./device-bundles"}
    
    if [ -z "$device_id" ]; then
        log_error "Usage: create_device_bundle <device_id> [output_dir]"
        return 1
    fi
    
    # Generate device certificate if it doesn't exist
    if [ ! -f "${CERT_DIR}/${device_id}.crt" ]; then
        generate_client_cert "$device_id"
    fi
    
    mkdir -p "${output_dir}/${device_id}"
    
    # Copy required files
    cp "${CERT_DIR}/ca.crt" "${output_dir}/${device_id}/"
    cp "${CERT_DIR}/${device_id}.crt" "${output_dir}/${device_id}/"
    cp "${CERT_DIR}/${device_id}.key" "${output_dir}/${device_id}/"
    
    # Create info file
    cat > "${output_dir}/${device_id}/README.txt" << EOF
FieldStream Device Certificate Bundle
=====================================
Device ID: ${device_id}
Generated: $(date)

Files:
- ca.crt          : Certificate Authority (trust anchor)
- ${device_id}.crt : Device certificate
- ${device_id}.key : Device private key (KEEP SECURE!)

Installation:
1. Copy all files to your device's certificate directory
2. Configure the device client to use these certificates
3. Ensure the private key is protected (chmod 400)

Expiry: $(openssl x509 -enddate -noout -in "${CERT_DIR}/${device_id}.crt" | cut -d= -f2)
EOF
    
    # Create tarball
    tar -czf "${output_dir}/${device_id}.tar.gz" -C "${output_dir}" "${device_id}"
    
    log_info "Device bundle created: ${output_dir}/${device_id}.tar.gz"
}

# Print usage
usage() {
    cat << EOF
FieldStream Certificate Lifecycle Management

Usage: $0 <command> [options]

Commands:
  init                    Initialize CA infrastructure
  generate-ca             Generate root Certificate Authority
  generate-all <domain>   Generate all standard certificates
  server <name> <cn>      Generate server certificate
  client <name> [cn]      Generate client certificate
  check                   Check all certificate expiry dates
  check <cert_file>       Check specific certificate expiry
  renew <name> [type]     Renew certificate (type: client|server)
  auto-renew              Auto-renew expiring certificates
  revoke <cert_file>      Revoke a certificate
  crl                     Generate/update CRL
  bundle <device_id>      Create device deployment bundle

Examples:
  $0 generate-all myserver.example.com
  $0 client field-device-002
  $0 check
  $0 auto-renew
  $0 bundle field-device-002

Environment Variables:
  CERT_DIR               Certificate directory (default: ./certs)
  CA_DAYS                CA validity in days (default: 3650)
  SERVER_DAYS            Server cert validity (default: 365)
  CLIENT_DAYS            Client cert validity (default: 90)
  RENEWAL_THRESHOLD_DAYS Days before expiry to trigger renewal (default: 30)
EOF
}

# Main command dispatcher
case "$1" in
    init)
        init_ca_infrastructure
        ;;
    generate-ca)
        init_ca_infrastructure
        generate_ca
        ;;
    generate-all)
        generate_all "$2"
        ;;
    server)
        generate_server_cert "$2" "$3" "$4"
        ;;
    client)
        generate_client_cert "$2" "$3"
        ;;
    check)
        if [ -n "$2" ]; then
            check_expiry "$2"
        else
            check_all_certs
        fi
        ;;
    renew)
        renew_cert "$2" "$3"
        ;;
    auto-renew)
        auto_renew
        ;;
    revoke)
        revoke_cert "$2"
        ;;
    crl)
        generate_crl
        ;;
    bundle)
        create_device_bundle "$2" "$3"
        ;;
    *)
        usage
        exit 1
        ;;
esac
