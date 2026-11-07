#!/usr/bin/env bash
# Generate local CA and Server TLS Certificates for Mosquitto (Port 8883)
# Usage: ./generate-certs.sh [GATEWAY_IP]

set -euo pipefail

GATEWAY_IP="${1:-192.168.1.100}"
CERT_DIR="${2:-./certs}"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "Generating Root CA for FoodWarden MQTTS..."
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=FoodWarden-Root-CA/O=FoodWarden" -out ca.crt

echo "Generating Mosquitto Server Certificate for IP: $GATEWAY_IP..."
openssl genrsa -out server.key 2048
openssl req -new -key server.key \
  -subj "/CN=$GATEWAY_IP/O=FoodWarden-Gateway" -out server.csr

cat > server_ext.cnf <<EOF
subjectAltName = IP:$GATEWAY_IP,IP:127.0.0.1,DNS:localhost,DNS:raspberrypi.local
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -sha256 -extfile server_ext.cnf

rm -f server.csr server_ext.cnf ca.srl
chmod 600 server.key ca.key
chmod 644 server.crt ca.crt

echo "Done! Certificates generated in $CERT_DIR:"
echo "  - ca.crt     (Copy to Node 'D' secrets.h & camera/.env MQTT_TLS_CA_CERT)"
echo "  - server.crt (Copy to /etc/mosquitto/certs/server.crt)"
echo "  - server.key (Copy to /etc/mosquitto/certs/server.key)"

