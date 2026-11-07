"""Firebase Cloud Functions HTTPS REST Client for Node 'C' <-> Server 'S'.

Implements grocery check-in draft/commit, FEFO check-out candidate draft/commit,
sensor telemetry batch upload, and door event logging per CBS.md.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

import httpx

from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckInCommitResult,
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutCommitPayload,
    CheckOutCommitResult,
    CheckOutDraftResult,
    DoorEventSyncPayload,
    TelemetrySyncPayload,
)

logger = logging.getLogger(__name__)


class CloudClient:
    """HTTPS REST client communicating with Firebase Cloud Functions."""

    def __init__(
        self,
        base_url: str = "https://asia-southeast1-foodwarden-app.cloudfunctions.net/api",
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

    def _get_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers=self._headers,
            timeout=self.timeout_s,
        )

    # ==========================================================================
    # 1. Grocery Check-In (CBS.md §3)
    # ==========================================================================

    def checkin_draft(self, image_jpeg_bytes: bytes) -> tuple[bool, CheckInDraftResult | None, str]:
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
                resp = client.post(url, files=files)

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
                err_msg = "Unidentifiable food item or low confidence"
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
        self, payload: CheckInCommitPayload
    ) -> tuple[bool, CheckInCommitResult | None, str]:
        """Commits finalized grocery check-in item to Firestore."""
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
                resp = client.post(url, json=payload.model_dump())

            if resp.status_code == 200:
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
        self, image_jpeg_bytes: bytes
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
                resp = client.post(url, files=files)

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
                resp = client.post(url, json=payload.model_dump())

            if resp.status_code == 200:
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
    # 3. Telemetry & Door Events (CBS.md §5 & §6)
    # ==========================================================================

    def sync_telemetry(self, payload: TelemetrySyncPayload) -> bool:
        """Uploads a batch of telemetry sensor readings to Server 'S'."""
        if self.mock_cloud:
            logger.debug("[MOCK_CLOUD] Synced %d telemetry readings", len(payload.telemetry))
            return True

        url = "/telemetry"
        try:
            with self._get_client() as client:
                resp = client.post(url, json=payload.model_dump())
            if resp.status_code == 200:
                logger.debug("Successfully synced %d telemetry readings", len(payload.telemetry))
                return True
            logger.warning("Telemetry sync rejected: HTTP %d - %s", resp.status_code, resp.text)
            return False
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Network connection error during telemetry sync: %s", exc)
            return False

    def sync_door_event(self, payload: DoorEventSyncPayload) -> bool:
        """Uploads a discrete door actuation safety event to Server 'S'."""
        if self.mock_cloud:
            logger.info("[MOCK_CLOUD] Synced door event: %s", payload.event_type)
            return True

        url = "/events/door"
        try:
            with self._get_client() as client:
                resp = client.post(url, json=payload.model_dump())
            if resp.status_code == 200:
                logger.info("Successfully synced door event: %s", payload.event_type)
                return True
            logger.warning("Door event sync rejected: HTTP %d - %s", resp.status_code, resp.text)
            return False
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Network connection error during door event sync: %s", exc)
            return False
