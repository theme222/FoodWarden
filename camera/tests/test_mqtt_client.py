"""Unit tests for MQTT over TLS Client for Node 'C' <-> Node 'D'."""

import json
import time
from unittest.mock import MagicMock

from foodwarden_camera.models.mqtt_cbd import (
    DoorEventEnvelope,
    DoorTelemetryPayload,
)
from foodwarden_camera.mqtt.client import (
    CMD_TOPIC,
    TIME_RES_TOPIC,
    DoorMQTTClient,
)


def test_mqtt_publish_commands() -> None:
    client = DoorMQTTClient()
    mock_paho = MagicMock()
    client._client = mock_paho

    # 1. Close door command
    client.send_close_door(node_id="D0", timeout_s=30)
    mock_paho.publish.assert_called_once()
    args, kwargs = mock_paho.publish.call_args
    assert args[0] == CMD_TOPIC
    published_json = json.loads(args[1])
    assert published_json["action"] == "CLOSE_DOOR"
    assert published_json["node_id"] == "D0"
    assert kwargs["qos"] == 1

    # 2. Abort command
    mock_paho.reset_mock()
    client.send_abort(node_id="D0", reason="HUMAN_APPROACH")
    mock_paho.publish.assert_called_once()
    args, kwargs = mock_paho.publish.call_args
    assert args[0] == CMD_TOPIC
    published_json = json.loads(args[1])
    assert published_json["action"] == "ABORT"
    assert published_json["reason"] == "HUMAN_APPROACH"
    assert kwargs["qos"] == 1


def test_mqtt_time_sync_response() -> None:
    client = DoorMQTTClient()
    mock_paho = MagicMock()
    client._client = mock_paho

    # Simulated incoming message on fridge/door/time/req
    req_data = {"node_id": "D0"}
    client._handle_time_req(req_data)

    mock_paho.publish.assert_called_once()
    args, kwargs = mock_paho.publish.call_args
    assert args[0] == TIME_RES_TOPIC
    res_data = json.loads(args[1])
    assert res_data["node_id"] == "D0"
    assert "timestamp" in res_data
    assert kwargs["qos"] == 1


def test_mqtt_door_event_and_state_tracking() -> None:
    events: list[DoorEventEnvelope] = []
    client = DoorMQTTClient(on_door_event=lambda e: events.append(e))

    # Trigger SUCCESS event
    event_data = {
        "node_id": "D0",
        "ack_cmd_id": "c-test-123",
        "event": {
            "type": "SUCCESS",
            "duration_ms": 4100,
            "peak_current_ma": 420,
        },
        "timestamp": 1729930020,
    }

    # Simulate door initially open
    client.set_door_state(is_open=True)
    assert client.is_door_open is True

    client._handle_door_event(event_data)
    assert len(events) == 1
    assert events[0].event.type == "SUCCESS"
    # SUCCESS event automatically sets door state to closed
    assert client.is_door_open is False


def test_mqtt_door_telemetry_and_ajar_duration() -> None:
    telems: list[DoorTelemetryPayload] = []
    client = DoorMQTTClient(on_door_telemetry=lambda t: telems.append(t))

    assert client.door_ajar_duration_s == 0.0

    # Door open telemetry (ir_closed == False)
    open_data = {
        "node_id": "D0",
        "timestamp": 1729930000,
        "state": "IDLE_OPEN",
        "ir_closed": False,
        "limit_switch_home": True,
        "current_ma": 0,
    }
    client._handle_door_telemetry(open_data)
    assert len(telems) == 1
    assert client.is_door_open is True

    # Artificially shift opened timestamp to simulate 65s open
    client._door_opened_at = time.time() - 65.0
    assert client.door_ajar_duration_s >= 60.0

    # Door closed telemetry (ir_closed == True)
    closed_data = {
        "node_id": "D0",
        "timestamp": 1729930070,
        "state": "IDLE_CLOSED",
        "ir_closed": True,
        "limit_switch_home": True,
        "current_ma": 0,
    }
    client._handle_door_telemetry(closed_data)
    assert client.is_door_open is False
    assert client.door_ajar_duration_s == 0.0
