"""Cloud Backend REST Client models (Node 'C' <-> Server 'S').

Mirrors the interface contract defined in interface/CBS.md.
"""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, Field

# ==============================================================================
# 1. Grocery Check-In Models (CBS.md §3)
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
    expiry_date: str = Field(description="Confirmed expiry date YYYY-MM-DD")
    storage_recommendation_th: str
    storage_recommendation_en: str
    image_storage_path: str
    confidence: float


class CheckInCommitResult(BaseModel):
    item_id: str
    created_at: int
    status: str = "COMMITTED"


# ==============================================================================
# 2. Grocery Check-Out Models (CBS.md §4)
# ==============================================================================


class CheckOutCandidate(BaseModel):
    """Candidate grocery item currently in fridge matching captured image."""

    item_id: str
    name_th: str
    name_en: str
    category: str
    category_th: str
    expiry_date: str
    confidence: float
    image_storage_path: str | None = None


class CheckOutDraftResult(BaseModel):
    """List of candidate items sorted by FEFO (First Expired, First Out)."""

    candidates: list[CheckOutCandidate] = Field(default_factory=list)


class CheckOutCommitPayload(BaseModel):
    """Payload to commit item removal (hard-delete) from Firestore."""

    item_id: str
    timestamp: int = Field(default_factory=lambda: int(time.time()))


class CheckOutCommitResult(BaseModel):
    item_id: str
    removed_at: int
    status: str = "REMOVED"


# ==============================================================================
# 3. Telemetry & Event Cloud Sync (CBS.md §5 & §6)
# ==============================================================================


class TelemetryItem(BaseModel):
    timestamp: int
    temperature_c: float | None = None
    voc_index: int | None = None
    light_level: int | None = None


class TelemetrySyncPayload(BaseModel):
    node_id: str = "F0"
    telemetry: list[TelemetryItem]


class DoorEventSyncPayload(BaseModel):
    node_id: str = "D0"
    event_type: str
    timestamp: int
    details: dict[str, Any] = Field(default_factory=dict)
