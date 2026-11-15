"""Unit tests for CBD.md MQTT models and event discrimination."""

import json

from pydantic import TypeAdapter

from foodwarden_camera.models.mqtt_cbd import (
    AbortCommand,
    CloseDoorCommand,
    DoorCommand,
    DoorEventEnvelope,
    DoorStatusPayload,
    DoorTelemetryPayload,
    TimeSyncRequest,
    TimeSyncResponse,
)


def test_command_serialization() -> None:
    close_cmd = CloseDoorCommand(node_id="D0", timeout_s=30, timestamp=1729930015)
    data = json.loads(close_cmd.model_dump_json())
    assert data["action"] == "CLOSE_DOOR"
    assert data["node_id"] == "D0"
    assert data["timeout_s"] == 30
    assert data["cmd_id"].startswith("c-")

    abort_cmd = AbortCommand(
        node_id="D0",
        reason="HUMAN_APPROACH",
        timestamp=1729930020,
    )
    abort_data = json.loads(abort_cmd.model_dump_json())
    assert abort_data["action"] == "ABORT"
    assert abort_data["reason"] == "HUMAN_APPROACH"

    # Polymorphic parsing
    adapter = TypeAdapter(DoorCommand)
    parsed_cmd = adapter.validate_python(abort_data)
    assert isinstance(parsed_cmd, AbortCommand)


def test_event_envelope_discrimination() -> None:
    # 1. Closing event
    raw_closing = {
        "node_id": "D0",
        "ack_cmd_id": "c-9b1d8f20",
        "event": {"type": "CLOSING"},
        "timestamp": 1729930016,
    }
    env1 = DoorEventEnvelope.model_validate(raw_closing)
    assert env1.event.type == "CLOSING"

    # 2. Success event
    raw_success = {
        "node_id": "D0",
        "ack_cmd_id": "c-9b1d8f20",
        "event": {"type": "SUCCESS", "duration_ms": 4200, "peak_current_ma": 450},
        "timestamp": 1729930020,
    }
    env2 = DoorEventEnvelope.model_validate(raw_success)
    assert env2.event.type == "SUCCESS"
    assert env2.event.duration_ms == 4200  # type: ignore

    # 3. Obstruction error event
    raw_obstruction = {
        "node_id": "D0",
        "ack_cmd_id": "c-9b1d8f20",
        "event": {"type": "OBSTRUCTION_ERROR", "stall_current_ma": 1320, "retracted": True},
        "timestamp": 1729930018,
    }
    env3 = DoorEventEnvelope.model_validate(raw_obstruction)
    assert env3.event.type == "OBSTRUCTION_ERROR"
    assert env3.event.stall_current_ma == 1320  # type: ignore

    # 4. Aborted event
    raw_aborted = {
        "node_id": "D0",
        "ack_cmd_id": "c-9b1d8f20",
        "event": {"type": "ABORTED", "reason": "MQTT_ABORT", "retracted": True},
        "timestamp": 1729930019,
    }
    env4 = DoorEventEnvelope.model_validate(raw_aborted)
    assert env4.event.type == "ABORTED"


def test_door_telemetry_model() -> None:
    payload = {
        "node_id": "D0",
        "timestamp": 1729930005,
        "state": "IDLE_CLOSED",
        "ir_closed": True,
        "limit_switch_home": True,
        "current_ma": 25,
    }
    telem = DoorTelemetryPayload.model_validate(payload)
    assert telem.state == "IDLE_CLOSED"
    assert telem.ir_closed is True
    assert telem.current_ma == 25


def test_time_sync_models() -> None:
    req = TimeSyncRequest(node_id="D0")
    assert req.node_id == "D0"

    res = TimeSyncResponse(node_id="D0", timestamp=1729930000)
    assert res.timestamp == 1729930000


def test_canonical_cbd_payloads() -> None:
    # 1. CBD.md §4.4 ABORTED with trigger
    aborted_env = DoorEventEnvelope.model_validate(
        {
            "node_id": "D0",
            "ack_cmd_id": "c-9b1d8f20-1a2c",
            "event": {"type": "ABORTED", "trigger": "REMOTE_ABORT", "retracted": True},
            "timestamp": 1729930022,
        }
    )
    assert aborted_env.event.type == "ABORTED"
    assert aborted_env.event.reason == "REMOTE_ABORT"  # type: ignore[union-attr]

    # 2. CBD.md §4.5 TIMEOUT_ERROR without retracted
    timeout_env = DoorEventEnvelope.model_validate(
        {
            "node_id": "D0",
            "ack_cmd_id": "c-9b1d8f20-1a2b",
            "event": {"type": "TIMEOUT_ERROR", "elapsed_ms": 30000},
            "timestamp": 1729930046,
        }
    )
    assert timeout_env.event.type == "TIMEOUT_ERROR"

    # 3. CBD.md §4.6 FAULT_LOCKOUT
    lockout_env = DoorEventEnvelope.model_validate(
        {
            "node_id": "D0",
            "ack_cmd_id": None,
            "event": {"type": "FAULT_LOCKOUT", "reason": "INA219_I2C_UNRESPONSIVE"},
            "timestamp": 1729930001,
        }
    )
    assert lockout_env.event.type == "FAULT_LOCKOUT"

    # 4. CBD.md §5 DoorTelemetryPayload canonical field names
    telem = DoorTelemetryPayload.model_validate(
        {
            "node_id": "D0",
            "timestamp": 1729930010,
            "ir_door_closed": False,
            "limit_switch_homed": True,
            "motor_state": "CLOSING",
            "current_ma": 320,
        }
    )
    assert telem.ir_closed is False
    assert telem.limit_switch_home is True
    assert telem.state == "CLOSING"

    # 5. CBD.md §6 Connection lifecycle status
    status = DoorStatusPayload.model_validate(
        {"node_id": "D0", "state": "ONLINE", "timestamp": 1729930001}
    )
    assert status.state == "ONLINE"
