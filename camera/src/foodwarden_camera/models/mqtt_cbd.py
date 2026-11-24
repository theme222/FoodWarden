"""MQTT over TLS Command, Event, and Telemetry models (Node 'C' <-> Node 'D').

Mirrors the interface contract defined in interface/CBD.md.
"""

from __future__ import annotations

import time
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

# ==============================================================================
# 1. Commands: Gateway 'C' -> Door 'D' (Topic: fridge/door/cmd)
# ==============================================================================


class CloseDoorCommand(BaseModel):
    """Command to initiate automated door closing."""

    cmd_id: str = Field(default_factory=lambda: f"c-{uuid.uuid4().hex[:12]}")
    node_id: str = Field(default="D0", description="Target door actuator ID")
    action: Literal["CLOSE_DOOR"] = "CLOSE_DOOR"
    timeout_s: int = Field(default=30, ge=5, le=120, description="Hard motion timeout")
    timestamp: int = Field(default_factory=lambda: int(time.time()))


class AbortCommand(BaseModel):
    """Emergency halt and retract command."""

    cmd_id: str = Field(default_factory=lambda: f"c-{uuid.uuid4().hex[:12]}")
    node_id: str = Field(default="D0", description="Target door actuator ID")
    action: Literal["ABORT"] = "ABORT"
    reason: Literal["HUMAN_APPROACH", "USER_CANCEL"] = Field(
        description="Trigger cause: vision-detected human or manual UI cancel"
    )
    timestamp: int = Field(default_factory=lambda: int(time.time()))


DoorCommand = Annotated[CloseDoorCommand | AbortCommand, Field(discriminator="action")]


# ==============================================================================
# 2. Events: Door 'D' -> Gateway 'C' (Topic: fridge/door/event)
# ==============================================================================


class ClosingEventData(BaseModel):
    type: Literal["CLOSING"] = "CLOSING"


class SuccessEventData(BaseModel):
    type: Literal["SUCCESS"] = "SUCCESS"
    duration_ms: int = Field(ge=0, description="Total motion duration from start to home")
    peak_current_ma: int = Field(ge=0, description="Peak current during closing stroke")


class ObstructionErrorEventData(BaseModel):
    type: Literal["OBSTRUCTION_ERROR"] = "OBSTRUCTION_ERROR"
    stall_current_ma: int = Field(ge=0, description="Current measured at cutoff point")
    retracted: bool = Field(default=True, description="True if arm safely returned to home switch")


class AbortedEventData(BaseModel):
    type: Literal["ABORTED"] = "ABORTED"
    trigger: str = Field(default="REMOTE_ABORT", description="e.g. REMOTE_ABORT, MANUAL_BUTTON")
    reason: str = Field(default="REMOTE_ABORT", description="Alias for abort trigger/reason")
    retracted: bool = Field(default=True, description="True if arm safely returned to home switch")

    @model_validator(mode="before")
    @classmethod
    def _sync_trigger_and_reason(cls, data: Any) -> Any:
        if isinstance(data, dict):
            normalized = dict(data)
            if "trigger" not in normalized and "reason" in normalized:
                normalized["trigger"] = normalized["reason"]
            elif "reason" not in normalized and "trigger" in normalized:
                normalized["reason"] = normalized["trigger"]
            return normalized
        return data


class TimeoutErrorEventData(BaseModel):
    type: Literal["TIMEOUT_ERROR"] = "TIMEOUT_ERROR"
    elapsed_ms: int = Field(ge=0, description="Milliseconds elapsed before timeout cutoff")
    retracted: bool = Field(default=False, description="True if arm safely returned to home switch")


class FaultLockoutEventData(BaseModel):
    type: Literal["FAULT_LOCKOUT"] = "FAULT_LOCKOUT"
    reason: str = Field(
        default="INA219_I2C_UNRESPONSIVE",
        description="e.g. INA219_I2C_UNRESPONSIVE, BOOT_HOMING_TIMEOUT",
    )


DoorEventData = Annotated[
    ClosingEventData
    | SuccessEventData
    | ObstructionErrorEventData
    | AbortedEventData
    | TimeoutErrorEventData
    | FaultLockoutEventData,
    Field(discriminator="type"),
]


class DoorEventEnvelope(BaseModel):
    """Envelope for all discrete state change events from Node 'D'."""

    node_id: str
    ack_cmd_id: str | None = None
    event: DoorEventData
    timestamp: int


# ==============================================================================
# 3. Telemetry: Door 'D' -> Gateway 'C' (Topic: fridge/door/telemetry)
# ==============================================================================


class DoorTelemetryPayload(BaseModel):
    """1 Hz periodic state telemetry from Node 'D'."""

    node_id: str
    timestamp: int
    state: str = Field(
        default="IDLE",
        description="e.g. IDLE, CLOSING, RETRACTING, FAULT, IDLE_OPEN, IDLE_CLOSED",
    )
    motor_state: str = Field(default="IDLE", description="Canonical CBD.md §5 motor_state")
    ir_closed: bool = Field(
        default=False, description="True when door frame proximity sensor reflects closed"
    )
    ir_door_closed: bool = Field(default=False, description="Canonical CBD.md §5 ir_door_closed")
    limit_switch_home: bool = Field(
        default=True, description="True when mechanical arm is fully retracted"
    )
    limit_switch_homed: bool = Field(
        default=True, description="Canonical CBD.md §5 limit_switch_homed"
    )
    current_ma: int = Field(ge=0, description="Armature current in mA measured by INA219")

    @model_validator(mode="before")
    @classmethod
    def _sync_telemetry_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        if "ir_door_closed" in normalized and "ir_closed" not in normalized:
            normalized["ir_closed"] = normalized["ir_door_closed"]
        elif "ir_closed" in normalized and "ir_door_closed" not in normalized:
            normalized["ir_door_closed"] = normalized["ir_closed"]

        if "limit_switch_homed" in normalized and "limit_switch_home" not in normalized:
            normalized["limit_switch_home"] = normalized["limit_switch_homed"]
        elif "limit_switch_home" in normalized and "limit_switch_homed" not in normalized:
            normalized["limit_switch_homed"] = normalized["limit_switch_home"]

        if "motor_state" in normalized and "state" not in normalized:
            normalized["state"] = normalized["motor_state"]
        elif "state" in normalized and "motor_state" not in normalized:
            normalized["motor_state"] = normalized["state"]

        return normalized


class DoorStatusPayload(BaseModel):
    """Connection lifecycle status / LWT message on fridge/door/status (CBD.md §6)."""

    node_id: str = "D0"
    state: str = "ONLINE"
    timestamp: int | None = None


# ==============================================================================
# 4. Time Synchronization (Topics: fridge/door/time/req & /res)
# ==============================================================================


class TimeSyncRequest(BaseModel):
    node_id: str = Field(description="Actuator node identifier, e.g. D0")


class TimeSyncResponse(BaseModel):
    node_id: str = Field(description="Actuator node identifier, e.g. D0")
    timestamp: int = Field(default_factory=lambda: int(time.time()))
