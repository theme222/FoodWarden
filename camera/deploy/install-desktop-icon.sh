#!/usr/bin/env bash
# Installs the FoodWarden desktop launcher icon and application menu entry on Pi-top [4].

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAMERA_DIR="$(dirname "$SCRIPT_DIR")"
ICON_PATH="$SCRIPT_DIR/foodwarden-icon.svg"
UV_BIN="$(command -v uv || echo "$HOME/.local/bin/uv")"

DESKTOP_CONTENT="[Desktop Entry]
Type=Application
Name=FoodWarden Camera Gateway
Comment=Launch FoodWarden Smart Fridge Camera UI (Node C)
Exec=/bin/bash -c \"export PATH=\$HOME/.local/bin:\$HOME/.cargo/bin:\$PATH && cd '$CAMERA_DIR' && '$UV_BIN' run --no-sync foodwarden-camera\"
Path=$CAMERA_DIR
Icon=$ICON_PATH
Terminal=false
Categories=Utility;Application;
StartupNotify=true
"

mkdir -p "$HOME/.local/share/applications"
printf "%s" "$DESKTOP_CONTENT" > "$HOME/.local/share/applications/foodwarden-camera.desktop"
chmod +x "$HOME/.local/share/applications/foodwarden-camera.desktop"

mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
cp "$ICON_PATH" "$HOME/.local/share/icons/hicolor/scalable/apps/foodwarden-camera.svg"

if [ -d "$HOME/Desktop" ]; then
    printf "%s" "$DESKTOP_CONTENT" > "$HOME/Desktop/foodwarden-camera.desktop"
    chmod +x "$HOME/Desktop/foodwarden-camera.desktop"
    if command -v gio >/dev/null 2>&1; then
        gio set "$HOME/Desktop/foodwarden-camera.desktop" metadata::trusted true 2>/dev/null || true
    fi
    echo "Installed desktop icon at $HOME/Desktop/foodwarden-camera.desktop"
else
    echo "No $HOME/Desktop directory found; installed menu entry at $HOME/.local/share/applications/foodwarden-camera.desktop"
fi
