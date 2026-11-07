"""MQTT over TLS Command, Event, and Telemetry models (Node 'C' <-> Node 'D').

Mirrors the interface contract defined in interface/CBD.md.
"""

from __future__ import annotations

import time
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field

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
    retracted: bool = Field(description="True if arm safely returned to home switch")


class AbortedEventData(BaseModel):
    type: Literal["ABORTED"] = "ABORTED"
    reason: str = Field(description="e.g. MQTT_ABORT, EMERGENCY_BUTTON")
    retracted: bool = Field(description="True if arm safely returned to home switch")


class TimeoutErrorEventData(BaseModel):
    type: Literal["TIMEOUT_ERROR"] = "TIMEOUT_ERROR"
    elapsed_ms: int = Field(ge=0, description="Milliseconds elapsed before timeout cutoff")
    retracted: bool = Field(description="True if arm safely returned to home switch")


DoorEventData = Annotated[
    ClosingEventData
    | SuccessEventData
    | ObstructionErrorEventData
    | AbortedEventData
    | TimeoutErrorEventData,
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
        description="e.g. IDLE_OPEN, IDLE_CLOSED, CLOSING_FORWARD, ABORT_REVERSING, ERROR_STALL"
    )
    ir_closed: bool = Field(description="True when door frame proximity sensor reflects closed")
    limit_switch_home: bool = Field(description="True when mechanical arm is fully retracted")
    current_ma: int = Field(ge=0, description="Armature current in mA measured by INA219")


# ==============================================================================
# 4. Time Synchronization (Topics: fridge/door/time/req & /res)
# ==============================================================================


class TimeSyncRequest(BaseModel):
    node_id: str = Field(description="Actuator node identifier, e.g. D0")


class TimeSyncResponse(BaseModel):
    node_id: str = Field(description="Actuator node identifier, e.g. D0")
    timestamp: int = Field(default_factory=lambda: int(time.time()))
