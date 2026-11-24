"""Server 'S' HTTPS REST Client for Node 'C' <-> Server 'S'.

Implements grocery check-in draft/commit, FEFO check-out candidate draft/commit,
sensor telemetry batch upload, door event logging, and status heartbeats per CBS.md.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Literal

import httpx

from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckInCommitResult,
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutCommitPayload,
    CheckOutCommitResult,
    CheckOutDraftResult,
    DoorEventBatchPayload,
    DoorEventItem,
    DoorEventSyncPayload,
    StatusPayload,
    TelemetrySyncPayload,
    normalize_door_event_status,
)

logger = logging.getLogger(__name__)

CloudErrorKind = Literal["offline", "unidentifiable", "auth", "rate_limited", "rejected"]


def classify_cloud_error(err_msg: str) -> CloudErrorKind:
    """Classifies CloudClient error text to distinguish offline loss from HTTP rejections."""
    upper = err_msg.upper()
    if "HTTP 422" in upper or "UNIDENTIFIABLE" in upper:
        return "unidentifiable"
    if (
        "HTTP 401" in upper
        or "HTTP 403" in upper
        or "UNAUTHORIZED" in upper
        or "INVALID_TOKEN" in upper
    ):
        return "auth"
    if "HTTP 429" in upper or "RATE_LIMITED" in upper:
        return "rate_limited"
    if "OPERATION_PENDING" in upper:
        return "offline"
    if "HTTP 400" in upper or "HTTP 413" in upper or "CONFLICT" in upper:
        return "rejected"
    return "offline"


class CloudClient:
    """HTTPS REST client communicating with Server 'S'."""

    def __init__(
        self,
        base_url: str = "https://foodwarden.newisnooby.workers.dev/api",
        gateway_token: str = "",
        timeout_s: float = 20.0,
        mock_cloud: bool = False,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.gateway_token = gateway_token
        self.timeout_s = timeout_s
        self.mock_cloud = mock_cloud

    @property
    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Accept": "application/json",
        }
        if self.gateway_token:
            headers["Authorization"] = f"Bearer {self.gateway_token}"
        return headers

    @staticmethod
    def _idempotency_headers(idempotency_key: str | None = None) -> dict[str, str]:
        return {"Idempotency-Key": idempotency_key or str(uuid.uuid4())}

    def _get_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers=self._headers,
            timeout=self.timeout_s,
        )

    # ==========================================================================
    # 1. Grocery Check-In (CBS.md §3)
    # ==========================================================================

    def checkin_draft(
        self,
        image_jpeg_bytes: bytes,
        idempotency_key: str | None = None,
    ) -> tuple[bool, CheckInDraftResult | None, str]:
        """Uploads compressed JPEG to request Gemini draft metadata.

        Returns:
            (success, draft_result_or_none, error_message)
        """
        if self.mock_cloud:
            today = datetime.now()
            mock_draft = CheckInDraftResult(
                name_th="นมสดพาสเจอร์ไรส์",
                name_en="Pasteurized Whole Milk",
                category="Dairy",
                category_th="นมและผลิตภัณฑ์นม",
                estimated_shelf_life_days=7,
                estimated_expiry_date=(today + timedelta(days=7)).strftime("%Y-%m-%d"),
                storage_recommendation_th="เก็บในช่องแช่เย็นหลัก (2-4 °C)",
                storage_recommendation_en="Store in main refrigerator shelf (2-4 °C)",
                image_storage_path=f"mock_storage/capture_{int(time.time())}.jpg",
                confidence=0.96,
            )
            logger.info("[MOCK_CLOUD] Check-in draft generated: %s", mock_draft.name_en)
            return True, mock_draft, ""

        url = "/inventory/checkin/draft"
        files = {
            "image": ("capture.jpg", image_jpeg_bytes, "image/jpeg"),
        }
        try:
            with self._get_client() as client:
                resp = client.post(
                    url,
                    files=files,
                    headers=self._idempotency_headers(idempotency_key),
                )

            if resp.status_code == 200:
                data = resp.json()
                result = CheckInDraftResult.model_validate(data)
                logger.info(
                    "Check-in draft successful for '%s' (conf=%.2f)",
                    result.name_en,
                    result.confidence,
                )
                return True, result, ""

            if resp.status_code == 422:
                err_msg = (
                    "HTTP 422 UNIDENTIFIABLE: Item could not be reliably identified "
                    "(confidence below 0.60 or non-food item)."
                )
                logger.warning("Check-in draft rejected: %s", resp.text)
                return False, None, err_msg

            err_msg = f"Check-in draft error: HTTP {resp.status_code} - {resp.text}"
            logger.error(err_msg)
            return False, None, err_msg

        except (httpx.RequestError, OSError) as exc:
            err_msg = f"Network connection error during check-in draft: {exc}"
            logger.warning(err_msg)
            return False, None, err_msg

    def checkin_commit(
        self,
        payload: CheckInCommitPayload,
        idempotency_key: str | None = None,
    ) -> tuple[bool, CheckInCommitResult | None, str]:
        """Commits finalized grocery check-in item to Server 'S'."""
        if self.mock_cloud:
            result = CheckInCommitResult(
                item_id=f"mock-item-{int(time.time())}",
                created_at=int(time.time()),
                status="COMMITTED",
            )
            logger.info("[MOCK_CLOUD] Check-in committed: %s (%s)", payload.name_en, result.item_id)
            return True, result, ""

        url = "/inventory/checkin"
        try:
            with self._get_client() as client:
                resp = client.post(
                    url,
                    json=payload.to_cbs_dict(),
                    headers=self._idempotency_headers(idempotency_key),
                )

            if resp.status_code in (200, 201):
                result = CheckInCommitResult.model_validate(resp.json())
                logger.info("Committed grocery check-in: item_id=%s", result.item_id)
                return True, result, ""

            err_msg = f"Check-in commit error: HTTP {resp.status_code} - {resp.text}"
            logger.error(err_msg)
            return False, None, err_msg

        except (httpx.RequestError, OSError) as exc:
            err_msg = f"Network connection error during check-in commit: {exc}"
            logger.warning(err_msg)
            return False, None, err_msg

    # ==========================================================================
    # 2. Grocery Check-Out (CBS.md §4)
    # ==========================================================================

    def checkout_draft(
        self,
        image_jpeg_bytes: bytes,
        idempotency_key: str | None = None,
    ) -> tuple[bool, CheckOutDraftResult | None, str]:
        """Uploads JPEG to request FEFO candidate matches from fridge inventory."""
        if self.mock_cloud:
            today = datetime.now()
            candidates = [
                CheckOutCandidate(
                    item_id="item-milk-01",
                    name_th="นมสดพาสเจอร์ไรส์",
                    name_en="Pasteurized Whole Milk",
                    category="Dairy",
                    category_th="นมและผลิตภัณฑ์นม",
                    expiry_date=(today + timedelta(days=2)).strftime("%Y-%m-%d"),
                    confidence=0.94,
                ),
                CheckOutCandidate(
                    item_id="item-yogurt-02",
                    name_th="โยเกิร์ตรสธรรมชาติ",
                    name_en="Plain Yogurt",
                    category="Dairy",
                    category_th="นมและผลิตภัณฑ์นม",
                    expiry_date=(today + timedelta(days=5)).strftime("%Y-%m-%d"),
                    confidence=0.88,
                ),
                CheckOutCandidate(
                    item_id="item-eggs-03",
                    name_th="ไข่ไก่สดเบอร์ 2",
                    name_en="Fresh Chicken Eggs",
                    category="Poultry",
                    category_th="ไข่และเนื้อสัตว์",
                    expiry_date=(today + timedelta(days=12)).strftime("%Y-%m-%d"),
                    confidence=0.82,
                ),
            ]
            logger.info("[MOCK_CLOUD] Check-out draft returned %d candidates", len(candidates))
            return True, CheckOutDraftResult(candidates=candidates), ""

        url = "/inventory/checkout/draft"
        files = {
            "image": ("capture.jpg", image_jpeg_bytes, "image/jpeg"),
        }
        try:
            with self._get_client() as client:
                resp = client.post(
                    url,
                    files=files,
                    headers=self._idempotency_headers(idempotency_key),
                )

            if resp.status_code == 200:
                result = CheckOutDraftResult.model_validate(resp.json())
                logger.info("Check-out draft returned %d candidates", len(result.candidates))
                return True, result, ""

            err_msg = f"Check-out draft error: HTTP {resp.status_code} - {resp.text}"
            logger.error(err_msg)
            return False, None, err_msg

        except (httpx.RequestError, OSError) as exc:
            err_msg = f"Network connection error during check-out draft: {exc}"
            logger.warning(err_msg)
            return False, None, err_msg

    def checkout_commit(
        self, payload: CheckOutCommitPayload
    ) -> tuple[bool, CheckOutCommitResult | None, str]:
        """Commits hard-delete removal of checked-out grocery item."""
        if self.mock_cloud:
            result = CheckOutCommitResult(
                item_id=payload.item_id,
                removed_at=int(time.time()),
                status="REMOVED",
            )
            logger.info("[MOCK_CLOUD] Check-out committed: %s", payload.item_id)
            return True, result, ""

        url = "/inventory/checkout"
        try:
            with self._get_client() as client:
                resp = client.post(url, json=payload.to_cbs_dict())

            if resp.status_code in (200, 201):
                result = CheckOutCommitResult.model_validate(resp.json())
                logger.info("Committed grocery check-out: item_id=%s", result.item_id)
                return True, result, ""

            err_msg = f"Check-out commit error: HTTP {resp.status_code} - {resp.text}"
            logger.error(err_msg)
            return False, None, err_msg

        except (httpx.RequestError, OSError) as exc:
            err_msg = f"Network connection error during check-out commit: {exc}"
            logger.warning(err_msg)
            return False, None, err_msg

    # ==========================================================================
    # 3. Telemetry, Door Events & Node Status (CBS.md §3.5, §3.6 & §3.7)
    # ==========================================================================

    def sync_telemetry(self, payload: TelemetrySyncPayload) -> bool:
        """Uploads a batch of telemetry sensor readings to Server 'S'."""
        if self.mock_cloud:
            logger.debug("[MOCK_CLOUD] Synced %d telemetry readings", len(payload.samples))
            return True

        url = "/telemetry"
        try:
            with self._get_client() as client:
                resp = client.post(url, json=payload.to_cbs_dict())
            if resp.status_code in (200, 201):
                logger.debug("Successfully synced %d telemetry readings", len(payload.samples))
                return True
            logger.warning("Telemetry sync rejected: HTTP %d - %s", resp.status_code, resp.text)
            return False
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Network connection error during telemetry sync: %s", exc)
            return False

    def sync_door_events_batch(self, events: list[DoorEventItem]) -> bool:
        """Uploads a batch of door safety events to POST /door_events (with legacy fallback)."""
        if not events:
            return True
        if self.mock_cloud:
            logger.info("[MOCK_CLOUD] Synced %d door event(s)", len(events))
            return True

        batch = DoorEventBatchPayload(events=events)
        try:
            with self._get_client() as client:
                resp = client.post("/door_events", json=batch.model_dump())
                if resp.status_code == 404:
                    resp = client.post("/events/door", json=batch.model_dump())
            if resp.status_code in (200, 201):
                logger.info("Successfully synced %d door event(s)", len(events))
                return True
            logger.warning("Door event sync rejected: HTTP %d - %s", resp.status_code, resp.text)
            return False
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Network connection error during door event sync: %s", exc)
            return False

    def sync_door_event(self, payload: DoorEventSyncPayload) -> bool:
        """Uploads a single discrete door actuation safety event to Server 'S'."""
        item = DoorEventItem(
            node_id=payload.node_id,
            timestamp_s=payload.timestamp,
            status=normalize_door_event_status(payload.event_type),
        )
        return self.sync_door_events_batch([item])

    def sync_status(self, payload: StatusPayload) -> bool:
        """Dispatches component connectivity heartbeat to POST /status per CBS.md §3.7."""
        if self.mock_cloud:
            logger.debug("[MOCK_CLOUD] Synced component status for %d node(s)", len(payload.nodes))
            return True

        try:
            with self._get_client() as client:
                resp = client.post("/status", json=payload.model_dump())
            if resp.status_code in (200, 201):
                logger.debug("Successfully synced status for %d node(s)", len(payload.nodes))
                return True
            logger.warning("Status heartbeat rejected: HTTP %d - %s", resp.status_code, resp.text)
            return False
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Network connection error during status heartbeat: %s", exc)
            return False

    def check_health(self) -> bool:
        """Checks connectivity to Server 'S' via GET /health."""
        if self.mock_cloud:
            return True
        try:
            with self._get_client() as client:
                resp = client.get("/health")
            return resp.status_code == 200
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Server health check failed: %s", exc)
            return False
