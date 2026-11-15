"""Cloud Backend REST Client models (Node 'C' <-> Server 'S').

Mirrors the interface contract defined in interface/CBS.md.
"""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, Field, model_validator

# ==============================================================================
# 1. Grocery Check-In Models (CBS.md §3.1 & §3.2)
# ==============================================================================


class CheckInDraftResult(BaseModel):
    """Draft prediction returned by Server 'S' from Gemini multimodal analysis."""

    name_th: str = Field(description="Localized food name in Thai")
    name_en: str = Field(description="Canonical food name in English")
    category: str = Field(description="Canonical category key (e.g. Dairy, Produce)")
    category_th: str = Field(description="Localized category name in Thai")
    estimated_shelf_life_days: int = Field(ge=0, description="Base shelf life in days")
    estimated_expiry_date: str = Field(description="ISO 8601 YYYY-MM-DD")
    storage_recommendation_th: str = Field(description="Storage guidance in Thai")
    storage_recommendation_en: str = Field(description="Storage guidance in English")
    image_storage_path: str = Field(description="Firebase Storage path of uploaded JPEG")
    confidence: float = Field(ge=0.0, le=1.0, description="Detection confidence score")


class CheckInCommitPayload(BaseModel):
    """Payload to commit finalized check-in item to Firestore."""

    name_th: str
    name_en: str
    category: str
    category_th: str
    estimated_shelf_life_days: int
    estimated_expiry_date: str = Field(default="", description="Confirmed expiry date YYYY-MM-DD")
    expiry_date: str = Field(default="", description="Alias for confirmed expiry date YYYY-MM-DD")
    storage_recommendation_th: str
    storage_recommendation_en: str
    image_storage_path: str
    confidence: float

    @model_validator(mode="before")
    @classmethod
    def _sync_expiry_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            normalized = dict(data)
            est = normalized.get("estimated_expiry_date")
            exp = normalized.get("expiry_date")
            if not est and exp:
                normalized["estimated_expiry_date"] = exp
            elif not exp and est:
                normalized["expiry_date"] = est
            return normalized
        return data

    def to_cbs_dict(self) -> dict[str, Any]:
        """Returns payload formatted strictly per CBS.md §3.2."""
        return {
            "name_th": self.name_th,
            "name_en": self.name_en,
            "category": self.category,
            "category_th": self.category_th,
            "estimated_shelf_life_days": self.estimated_shelf_life_days,
            "estimated_expiry_date": self.estimated_expiry_date,
            "storage_recommendation_th": self.storage_recommendation_th,
            "storage_recommendation_en": self.storage_recommendation_en,
            "image_storage_path": self.image_storage_path,
            "confidence": self.confidence,
        }


class CheckInCommitResult(BaseModel):
    item_id: str
    created_at: int = Field(default_factory=lambda: int(time.time()))
    status: str = "COMMITTED"
    success: bool = True
    message: str = ""


# ==============================================================================
# 2. Grocery Check-Out Models (CBS.md §3.3 & §3.4)
# ==============================================================================


class CheckOutCandidate(BaseModel):
    """Candidate grocery item currently in fridge matching captured image."""

    item_id: str
    name_th: str
    name_en: str
    category: str
    category_th: str
    expiry_date: str = ""
    estimated_expiry_date: str = ""
    confidence: float = 1.0
    image_storage_path: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _sync_expiry_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            normalized = dict(data)
            est = normalized.get("estimated_expiry_date")
            exp = normalized.get("expiry_date")
            if not est and exp:
                normalized["estimated_expiry_date"] = exp
            elif not exp and est:
                normalized["expiry_date"] = est
            return normalized
        return data


class CheckOutDraftResult(BaseModel):
    """List of candidate items sorted by FEFO (First Expired, First Out)."""

    match_type: str = "EXACT_MATCH"
    candidate_matches: list[CheckOutCandidate] = Field(default_factory=list)
    candidates: list[CheckOutCandidate] = Field(default_factory=list)
    confidence: float = 1.0
    reasoning: str = ""

    @model_validator(mode="before")
    @classmethod
    def _sync_candidate_lists(cls, data: Any) -> Any:
        if isinstance(data, dict):
            normalized = dict(data)
            if "candidate_matches" not in normalized and "candidates" in normalized:
                normalized["candidate_matches"] = normalized["candidates"]
            elif "candidates" not in normalized and "candidate_matches" in normalized:
                normalized["candidates"] = normalized["candidate_matches"]
            return normalized
        return data


class CheckOutCommitPayload(BaseModel):
    """Payload to commit item removal (hard-delete) from Firestore."""

    item_id: str
    timestamp: int = Field(default_factory=lambda: int(time.time()))

    def to_cbs_dict(self) -> dict[str, Any]:
        """Returns payload formatted strictly per CBS.md §3.4."""
        return {"item_id": self.item_id}


class CheckOutCommitResult(BaseModel):
    item_id: str
    removed_at: int = Field(default_factory=lambda: int(time.time()))
    status: str = "REMOVED"
    success: bool = True
    message: str = ""


# ==============================================================================
# 3. Telemetry, Door Events & Status Heartbeat Sync (CBS.md §3.5, §3.6 & §3.7)
# ==============================================================================

VALID_DOOR_EVENT_STATUSES: tuple[str, ...] = (
    "CLOSING",
    "SUCCESS",
    "OBSTRUCTION_ERROR",
    "ABORTED",
    "TIMEOUT_ERROR",
    "FAULT_LOCKOUT",
    "CONTRADICTION_ERROR",
)


def normalize_door_event_status(event_type: str) -> str:
    """Maps legacy internal event names to canonical CBS.md §3.6 statuses."""
    if event_type == "IR_LIGHT_MISMATCH_ERROR":
        return "CONTRADICTION_ERROR"
    return event_type


class TelemetrySamplePayload(BaseModel):
    """Canonical CBS.md §3.5 telemetry sample."""

    node_id: str = "F0"
    timestamp_s: int
    temp_celsius: float | None = None
    voc_index: int | None = None
    light_ldr: int | None = None


class TelemetryItem(BaseModel):
    """Legacy telemetry sample model kept for backward compatibility."""

    timestamp: int
    temperature_c: float | None = None
    voc_index: int | None = None
    light_level: int | None = None


class TelemetrySyncPayload(BaseModel):
    """Batched telemetry ingestion payload supporting CBS.md §3.5 and legacy callers."""

    node_id: str = "F0"
    samples: list[TelemetrySamplePayload] = Field(default_factory=list)
    telemetry: list[TelemetryItem] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _populate_samples_and_legacy(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        node_id = str(normalized.get("node_id") or "F0")
        raw_samples = normalized.get("samples")
        raw_legacy = normalized.get("telemetry")

        if raw_samples and not raw_legacy:
            legacy_items: list[dict[str, Any]] = []
            for item in raw_samples:
                if isinstance(item, TelemetrySamplePayload):
                    legacy_items.append(
                        {
                            "timestamp": item.timestamp_s,
                            "temperature_c": item.temp_celsius,
                            "voc_index": item.voc_index,
                            "light_level": item.light_ldr,
                        }
                    )
                elif isinstance(item, dict):
                    legacy_items.append(
                        {
                            "timestamp": item["timestamp_s"],
                            "temperature_c": item.get("temp_celsius"),
                            "voc_index": item.get("voc_index"),
                            "light_level": item.get("light_ldr"),
                        }
                    )
            normalized["telemetry"] = legacy_items
            if raw_samples:
                first = raw_samples[0]
                first_node = (
                    first.node_id
                    if isinstance(first, TelemetrySamplePayload)
                    else first.get("node_id", node_id)
                )
                normalized.setdefault("node_id", first_node)
        elif raw_legacy and not raw_samples:
            cbs_samples: list[dict[str, Any]] = []
            for item in raw_legacy:
                if isinstance(item, TelemetryItem):
                    cbs_samples.append(
                        {
                            "node_id": node_id,
                            "timestamp_s": item.timestamp,
                            "temp_celsius": item.temperature_c,
                            "voc_index": item.voc_index,
                            "light_ldr": item.light_level,
                        }
                    )
                elif isinstance(item, dict):
                    cbs_samples.append(
                        {
                            "node_id": node_id,
                            "timestamp_s": item["timestamp"],
                            "temp_celsius": item.get("temperature_c"),
                            "voc_index": item.get("voc_index"),
                            "light_ldr": item.get("light_level"),
                        }
                    )
            normalized["samples"] = cbs_samples

        return normalized

    def to_cbs_dict(self) -> dict[str, Any]:
        """Returns payload formatted strictly per CBS.md §3.5 and Server telemetry.ts."""
        return {"samples": [sample.model_dump() for sample in self.samples]}


class DoorEventItem(BaseModel):
    """Canonical CBS.md §3.6 door event entry."""

    node_id: str = "D0"
    timestamp_s: int
    status: str


class DoorEventBatchPayload(BaseModel):
    """Canonical CBS.md §3.6 batch payload for POST /door_events."""

    events: list[DoorEventItem]


class DoorEventSyncPayload(BaseModel):
    """Single door event payload supporting CBS.md §3.6 batch conversion."""

    node_id: str = "D0"
    event_type: str
    timestamp: int
    details: dict[str, Any] = Field(default_factory=dict)

    def to_cbs_dict(self) -> dict[str, Any]:
        """Returns payload formatted strictly per CBS.md §3.6 and Server door-events.ts."""
        item = DoorEventItem(
            node_id=self.node_id,
            timestamp_s=self.timestamp,
            status=normalize_door_event_status(self.event_type),
        )
        return {"events": [item.model_dump()]}


class NodeStatusItem(BaseModel):
    """Per-component contact timestamp per CBS.md §3.7."""

    node_id: str
    last_seen_s: int | None = None


class StatusPayload(BaseModel):
    """Component status heartbeat payload for POST /status."""

    nodes: list[NodeStatusItem]
