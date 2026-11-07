#!/usr/bin/env bash
# ==============================================================================
# Automated Setup Script for FoodWarden Node 'C' on Pi-top [4] (Bookworm 64-bit)
# Usage:
#   cd ~/FoodWarden/camera/deploy
#   chmod +x setup-pitop.sh
#   ./setup-pitop.sh [MQTT_PASSWORD]
# ==============================================================================

set -euo pipefail

MQTT_PASS="${1:-foodwarden123}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAMERA_DIR="$(dirname "$SCRIPT_DIR")"
CURRENT_USER="$(whoami)"
USER_HOME="$HOME"

# Detect local IPv4 address for TLS certificate SAN
GATEWAY_IP="$(hostname -I | awk '{print $1}')"
if [ -z "$GATEWAY_IP" ]; then
    GATEWAY_IP="127.0.0.1"
fi

echo "=================================================================="
echo " FoodWarden Node 'C' Deployment on Pi-top [4]"
echo " User: $CURRENT_USER | Camera Dir: $CAMERA_DIR | IP: $GATEWAY_IP"
echo "=================================================================="

# 1. Install OS packages, Minimal X11 (for OS Lite), Thai fonts, Mosquitto, and ARM64 Python bindings
echo "[1/6] Installing system packages, Minimal X11, Thai fonts, and Mosquitto..."
sudo apt update
sudo apt install -y \
    git curl openssl \
    xserver-xorg xserver-xorg-legacy xinit x11-xserver-utils openbox \
    mosquitto mosquitto-clients \
    fonts-thai-tlwg fonts-noto-core \
    libgl1 libglib2.0-0 \
    python3-pyqt6 python3-gpiozero python3-lgpio python3-opencv \
    bluez libbluetooth-dev

# Allow starting X11 from SSH or tty1 console autologin
if [ -f /etc/X11/Xwrapper.config ]; then
    sudo sed -i 's/allowed_users=console/allowed_users=anybody/' /etc/X11/Xwrapper.config
else
    echo "allowed_users=anybody" | sudo tee /etc/X11/Xwrapper.config >/dev/null
fi

# 2. Ensure uv is installed
echo "[2/6] Checking uv package manager..."
if ! command -v uv >/dev/null 2>&1 && [ ! -f "$USER_HOME/.local/bin/uv" ]; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$USER_HOME/.local/bin:$PATH"

# 3. Generate Mosquitto TLS Certificates and configure Port 8883
echo "[3/6] Configuring Mosquitto TLS Broker on port 8883..."
cd "$SCRIPT_DIR"
chmod +x generate-certs.sh
./generate-certs.sh "$GATEWAY_IP" "$SCRIPT_DIR/certs"

sudo mkdir -p /etc/mosquitto/certs
sudo cp "$SCRIPT_DIR/certs/ca.crt" "$SCRIPT_DIR/certs/server.crt" "$SCRIPT_DIR/certs/server.key" /etc/mosquitto/certs/
sudo chown -R mosquitto:mosquitto /etc/mosquitto/certs
sudo chmod 600 /etc/mosquitto/certs/server.key
sudo chmod 644 /etc/mosquitto/certs/server.crt /etc/mosquitto/certs/ca.crt

sudo cp "$SCRIPT_DIR/mosquitto-tls.conf" /etc/mosquitto/conf.d/foodwarden-tls.conf
# Strip any Windows CRLF line endings from config and certs
sudo sed -i 's/\r$//' /etc/mosquitto/conf.d/foodwarden-tls.conf
sudo sed -i 's/\r$//' /etc/mosquitto/certs/ca.crt /etc/mosquitto/certs/server.crt /etc/mosquitto/certs/server.key

sudo mosquitto_passwd -b -c /etc/mosquitto/passwd foodwarden_client "$MQTT_PASS"
sudo chown mosquitto:mosquitto /etc/mosquitto/passwd
sudo chmod 600 /etc/mosquitto/passwd

sudo systemctl enable mosquitto
sudo systemctl restart mosquitto || {
    echo "WARNING: Mosquitto failed to start. Showing journalctl logs:"
    sudo journalctl -u mosquitto -n 15 --no-pager || true
}

# 4. Create Python 3.11 virtualenv (inheriting ARM64 system packages) & sync uv
echo "[4/6] Setting up Python 3.11 environment in $CAMERA_DIR..."
cd "$CAMERA_DIR"
uv venv --python 3.11 --system-site-packages --allow-existing
uv sync --inexact

# Install pitop SDK & gpiozero inside venv if available on Pi-top OS
uv pip install gpiozero rpi-lgpio || true
uv pip install pitop || echo "Note: pitop SDK using system site-packages or fallback mode."

# 5. Initialize .env if not already created
echo "[5/6] Checking .env file..."
if [ ! -f "$CAMERA_DIR/.env" ]; then
    cp "$CAMERA_DIR/../.env.example" "$CAMERA_DIR/.env"
    sed -i "s|MQTT_PASSWORD=YOUR_MQTT_PASSWORD|MQTT_PASSWORD=$MQTT_PASS|g" "$CAMERA_DIR/.env"
    sed -i "s|MOCK_CLOUD=false|MOCK_CLOUD=true|g" "$CAMERA_DIR/.env"
    echo "PIR_GPIO_PIN=-1" >> "$CAMERA_DIR/.env"
    echo "Created $CAMERA_DIR/.env with MOCK_CLOUD=true and PIR_GPIO_PIN=-1."
fi

# 6. Configure Kiosk Autostart (supports both OS Lite B2 Console Autologin & Desktop)
echo "[6/6] Configuring Kiosk Autostart..."
mkdir -p "$USER_HOME/.config/autostart"
cat > "$USER_HOME/.config/autostart/foodwarden-camera.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=FoodWarden Camera Gateway (Node C)
Comment=Auto-start FoodWarden 5-inch LCD UI on boot
Exec=/bin/bash -c "cd $CAMERA_DIR && $USER_HOME/.local/bin/uv run --no-sync foodwarden-camera"
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

# Also configure ~/.bash_profile for Raspberry Pi OS Lite (B2 Console Autologin on tty1)
if ! grep -q "foodwarden-camera" "$USER_HOME/.bash_profile" 2>/dev/null; then
    cat >> "$USER_HOME/.bash_profile" <<EOF

# Auto-launch FoodWarden UI on 5-inch LCD when logged in on tty1 (B2 Console Autologin)
if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ]; then
    cd "$CAMERA_DIR"
    exec startx "$USER_HOME/.local/bin/uv" run --no-sync foodwarden-camera -- :0 vt1
fi
EOF
fi

echo "=================================================================="
echo " Deployment Complete!"
echo " - Mosquitto TLS Broker active on $GATEWAY_IP:8883"
echo " - CA Certificate for Node 'D': /etc/mosquitto/certs/ca.crt"
echo " - Run manually: cd $CAMERA_DIR && ~/.local/bin/uv run --no-sync foodwarden-camera"
echo "=================================================================="

