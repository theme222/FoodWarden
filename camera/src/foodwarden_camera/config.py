"""Application configuration for FoodWarden Node 'C' (Camera & Edge Gateway)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Automatically load .env if present
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class GatewaySettings(BaseModel):
    """Central configuration for Gateway Node 'C' loaded from environment."""

    # Node Identification
    node_id: str = Field(default="C0", description="Gateway node identifier")

    # BLE Telemetry Decryption (Node 'F' -> Node 'C' via FUC.md)
    aes_key_hex: str = Field(
        default=os.getenv("AES_KEY", "000102030405060708090a0b0c0d0e0f"),
        description="16-byte pre-shared AES key as 32 hex characters",
    )

    # Local Mosquitto MQTT Broker over TLS (Node 'C' <-> Node 'D' via CBD.md)
    mqtt_broker_host: str = Field(
        default=os.getenv("MQTT_BROKER_HOST", "127.0.0.1"),
        description="Local MQTT broker hostname or IP",
    )
    mqtt_broker_port: int = Field(
        default=int(os.getenv("MQTT_BROKER_PORT", "8883")),
        description="Local MQTT broker port (8883 for TLS)",
    )
    mqtt_username: str = Field(
        default=os.getenv("MQTT_USERNAME", "foodwarden_client"),
        description="MQTT client username",
    )
    mqtt_password: str = Field(
        default=os.getenv("MQTT_PASSWORD", ""),
        description="MQTT client password",
    )
    mqtt_tls_ca_cert: str = Field(
        default=os.getenv("MQTT_TLS_CA_CERT", "/etc/mosquitto/certs/ca.crt"),
        description="CA certificate path for MQTT TLS",
    )
    mqtt_tls_server_cert: str = Field(
        default=os.getenv("MQTT_TLS_SERVER_CERT", "/etc/mosquitto/certs/server.crt"),
        description="Server certificate path for MQTT broker",
    )
    mqtt_tls_server_key: str = Field(
        default=os.getenv("MQTT_TLS_SERVER_KEY", "/etc/mosquitto/certs/server.key"),
        description="Server private key path for MQTT broker",
    )

    # Gateway Cloud Backend REST Client (Node 'C' <-> Server 'S' via CBS.md)
    firebase_api_base_url: str = Field(
        default=os.getenv(
            "FIREBASE_API_BASE_URL",
            "https://asia-southeast1-foodwarden-app.cloudfunctions.net/api",
        ),
        description="Base URL for Firebase Cloud Functions REST API",
    )
    gateway_token: str = Field(
        default=os.getenv("GATEWAY_TOKEN", ""),
        description="Permanent Bearer API token for Firebase Cloud Functions",
    )
    mock_cloud: bool = Field(
        default=os.getenv("MOCK_CLOUD", "false").lower() in ("true", "1", "yes"),
        description="Enable simulated cloud responses for local testing without backend",
    )

    # Local Offline SQLite Queue Path (Rubric E4 Store-and-Forward)
    sqlite_db_path: str = Field(
        default=os.getenv("SQLITE_DB_PATH", "foodwarden_gateway.db"),
        description="Local SQLite database file path for buffering offline events",
    )

    # Hardware & Peripherals
    webcam_index: int = Field(
        default=int(os.getenv("WEBCAM_INDEX", "0")),
        description="OpenCV VideoCapture index (/dev/video0 -> 0)",
    )
    yolo_model_path: str = Field(
        default=os.getenv("YOLO_MODEL_PATH", "yolo26n.pt"),
        description="YOLO weights file path (default: yolo26n.pt)",
    )
    pir_gpio_pin: int = Field(
        default=int(os.getenv("PIR_GPIO_PIN", "22")),
        description="Pi-top Hub GPIO pin for PIR motion sensor",
    )

    @property
    def aes_key(self) -> bytes:
        """Returns the 16-byte decoded AES key."""
        return bytes.fromhex(self.aes_key_hex)


settings = GatewaySettings()
