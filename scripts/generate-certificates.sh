#!/bin/bash
# Automated certificate generation for internal mTLS

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <your-dmz-server.com>"
    exit 1
fi

DOMAIN=$1
CERT_DIR="./certs"
CA_DAYS=3650
SERVER_DAYS=365
CLIENT_DAYS=365

mkdir -p ${CERT_DIR}
echo "Generating certificates in ${CERT_DIR}/"

# --- Certificate Authority (CA) ---
openssl genrsa -out ${CERT_DIR}/ca.key 4096
openssl req -new -x509 -days ${CA_DAYS} -key ${CERT_DIR}/ca.key \
    -out ${CERT_DIR}/ca.crt \
    -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=IoT Division/CN=IoT Root CA"

# --- DMZ WebSocket/MQTT Server Certificate ---
openssl genrsa -out ${CERT_DIR}/dmz-server.key 2048
openssl req -new -key ${CERT_DIR}/dmz-server.key \
    -out ${CERT_DIR}/dmz-server.csr \
    -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=DMZ Services/CN=${DOMAIN}"

openssl x509 -req -in ${CERT_DIR}/dmz-server.csr -CA ${CERT_DIR}/ca.crt \
    -CAkey ${CERT_DIR}/ca.key -CAcreateserial \
    -out ${CERT_DIR}/dmz-server.crt -days ${SERVER_DAYS}

# --- DMZ MQTT Bridge Client Certificate (for connecting to internal broker) ---
openssl genrsa -out ${CERT_DIR}/dmz-bridge-client.key 2048
openssl req -new -key ${CERT_DIR}/dmz-bridge-client.key \
    -out ${CERT_DIR}/dmz-bridge-client.csr \
    -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=DMZ Services/CN=dmz-bridge"

openssl x509 -req -in ${CERT_DIR}/dmz-bridge-client.csr -CA ${CERT_DIR}/ca.crt \
    -CAkey ${CERT_DIR}/ca.key -CAcreateserial \
    -out ${CERT_DIR}/dmz-bridge-client.crt -days ${CLIENT_DAYS}

# --- Internal MQTT Server Certificate ---
openssl genrsa -out ${CERT_DIR}/internal-server.key 2048
openssl req -new -key ${CERT_DIR}/internal-server.key \
    -out ${CERT_DIR}/internal-server.csr \
    -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=Internal Services/CN=internal-mqtt-broker"

openssl x509 -req -in ${CERT_DIR}/internal-server.csr -CA ${CERT_DIR}/ca.crt \
    -CAkey ${CERT_DIR}/ca.key -CAcreateserial \
    -out ${CERT_DIR}/internal-server.crt -days ${SERVER_DAYS}


# --- Field Device Client Certificate ---
generate_client_cert() {
    local client_name=$1
    echo "Generating certificate for client: ${client_name}"
    openssl genrsa -out ${CERT_DIR}/${client_name}.key 2048
    openssl req -new -key ${CERT_DIR}/${client_name}.key \
        -out ${CERT_DIR}/${client_name}.csr \
        -subj "/C=US/ST=CA/L=YourCity/O=YourCompany/OU=IoT Devices/CN=${client_name}"

    openssl x509 -req -in ${CERT_DIR}/${client_name}.csr -CA ${CERT_DIR}/ca.crt \
        -CAkey ${CERT_DIR}/ca.key -CAcreateserial \
        -out ${CERT_DIR}/${client_name}.crt -days ${CLIENT_DAYS}

    rm ${CERT_DIR}/${client_name}.csr
}

generate_client_cert "field-device-001"
generate_client_cert "data-distributor" # For connecting to internal MQTT

# Cleanup
rm ${CERT_DIR}/*.csr
rm ${CERT_DIR}/*.srl

echo "Certificates generated successfully."