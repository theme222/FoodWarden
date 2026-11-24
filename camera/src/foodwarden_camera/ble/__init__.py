"""BLE GATT Telemetry and Time Synchronization client package."""

from foodwarden_camera.ble.receiver import (
    TELEMETRY_CHAR_UUID,
    TELEMETRY_SERVICE_UUID,
    TIME_SYNC_CHAR_UUID,
    BLEReceiver,
    PDRTracker,
)

__all__ = [
    "TELEMETRY_CHAR_UUID",
    "TELEMETRY_SERVICE_UUID",
    "TIME_SYNC_CHAR_UUID",
    "BLEReceiver",
    "PDRTracker",
]
