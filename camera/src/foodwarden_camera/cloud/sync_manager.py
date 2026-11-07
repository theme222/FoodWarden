"""Cloud Sync Manager implementing Rubric E4 Store-and-Forward.

Coordinates real-time cloud communications with local SQLite offline buffering,
flushing pending queues with exponential backoff whenever network connectivity is restored.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from foodwarden_camera.cloud.client import CloudClient
from foodwarden_camera.models.ble_fuc import SensorSample
from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    DoorEventSyncPayload,
    TelemetryItem,
    TelemetrySyncPayload,
)
from foodwarden_camera.storage.offline_queue import OfflineQueue

logger = logging.getLogger(__name__)


class CloudSyncManager:
    """Orchestrates cloud REST syncing with automatic offline queue fallback."""

    def __init__(
        self,
        cloud_client: CloudClient,
        offline_queue: OfflineQueue,
        captures_dir: str = "captures",
    ) -> None:
        self.client = cloud_client
        self.queue = offline_queue
        self.captures_dir = Path(captures_dir)
        self.captures_dir.mkdir(parents=True, exist_ok=True)

        self._running: bool = False
        self._thread: threading.Thread | None = None
        self._is_online: bool = True
        self._lock = threading.Lock()

    @property
    def is_online(self) -> bool:
        return self._is_online

    # ==========================================================================
    # Real-Time or Offline Enqueue
    # ==========================================================================

    def send_or_enqueue_telemetry(self, node_id: str, sample: SensorSample) -> bool:
        """Attempts real-time cloud sync; buffers to SQLite if offline."""
        item = TelemetryItem(
            timestamp=sample.timestamp_s,
            temperature_c=sample.temp_celsius,
            voc_index=sample.voc_index,
            light_level=sample.light_ldr,
        )
        payload = TelemetrySyncPayload(node_id=node_id, telemetry=[item])

        success = self.client.sync_telemetry(payload)
        if success:
            self._is_online = True
            return True

        # Failed: buffer to SQLite
        self._is_online = False
        self.queue.enqueue_telemetry(node_id, sample)
        logger.info("Buffered telemetry reading from %s to offline queue", node_id)
        return False

    def send_or_enqueue_door_event(
        self,
        node_id: str,
        event_type: str,
        timestamp: int,
        details: dict[str, Any],
    ) -> bool:
        """Attempts real-time cloud sync; buffers to SQLite if offline."""
        payload = DoorEventSyncPayload(
            node_id=node_id,
            event_type=event_type,
            timestamp=timestamp,
            details=details,
        )
        success = self.client.sync_door_event(payload)
        if success:
            self._is_online = True
            return True

        # Failed: buffer to SQLite
        self._is_online = False
        self.queue.enqueue_door_event(node_id, event_type, timestamp, details)
        logger.info("Buffered door event %s to offline queue", event_type)
        return False

    def enqueue_offline_checkin(
        self,
        image_bytes: bytes,
        confirmed_expiry: str | None = None,
    ) -> int:
        """Saves image to disk and enqueues offline check-in record."""
        now = int(time.time())
        filename = f"offline_checkin_{now}.jpg"
        file_path = self.captures_dir / filename

        with open(file_path, "wb") as f:
            f.write(image_bytes)

        checkin_id = self.queue.enqueue_checkin(
            image_path=str(file_path),
            captured_at=now,
            confirmed_expiry=confirmed_expiry,
        )
        logger.info("Enqueued offline grocery check-in: id=%d, file=%s", checkin_id, file_path)
        return checkin_id

    # ==========================================================================
    # Queue Draining / Flush Operations
    # ==========================================================================

    def flush_offline_queue(self) -> dict[str, int]:
        """Drains pending SQLite records to cloud server.

        Returns:
            Dictionary of synced count per category.
        """
        counts = {"telemetry": 0, "door_events": 0, "checkins": 0}

        # 1. Flush Pending Telemetry in Batches
        pending_telemetry = self.queue.get_pending_telemetry(limit=100)
        if pending_telemetry:
            # Group by node_id
            by_node: dict[str, list[dict[str, Any]]] = {}
            for row in pending_telemetry:
                by_node.setdefault(str(row["node_id"]), []).append(row)

            for node_id, rows in by_node.items():
                items = [
                    TelemetryItem(
                        timestamp=int(r["timestamp_s"]),
                        temperature_c=float(r["temp_cdeg"]) if r["temp_cdeg"] is not None else None,
                        voc_index=int(r["voc_index"]) if r["voc_index"] is not None else None,
                        light_level=int(r["light_ldr"]) if r["light_ldr"] is not None else None,
                    )
                    for r in rows
                ]
                payload = TelemetrySyncPayload(node_id=node_id, telemetry=items)
                if self.client.sync_telemetry(payload):
                    synced_ids = [int(r["id"]) for r in rows]
                    self.queue.delete_telemetry(synced_ids)
                    counts["telemetry"] += len(synced_ids)
                    self._is_online = True
                else:
                    self._is_online = False
                    break

        # 2. Flush Pending Door Events
        pending_events = self.queue.get_pending_door_events(limit=50)
        for evt in pending_events:
            event_payload = DoorEventSyncPayload(
                node_id=str(evt["node_id"]),
                event_type=str(evt["event_type"]),
                timestamp=int(evt["timestamp"]),
                details=dict(evt["details"]),
            )
            if self.client.sync_door_event(event_payload):
                self.queue.delete_door_events([int(evt["id"])])
                counts["door_events"] += 1
                self._is_online = True
            else:
                self._is_online = False
                break

        # 3. Flush Pending Offline Check-Ins (E4 & Goal.md §3)
        pending_checkins = self.queue.get_pending_checkins(limit=5)
        for chk in pending_checkins:
            img_path = Path(str(chk["image_path"]))
            if not img_path.exists():
                logger.warning("Offline check-in image missing: %s; deleting record", img_path)
                self.queue.delete_checkin(int(chk["id"]))
                continue

            with open(img_path, "rb") as f:
                img_bytes = f.read()

            draft_ok, draft_res, _ = self.client.checkin_draft(img_bytes)
            if draft_ok and draft_res is not None:
                # Use user confirmed expiry if set, otherwise fallback to AI suggestion
                expiry = (
                    str(chk["confirmed_expiry"])
                    if chk["confirmed_expiry"]
                    else draft_res.estimated_expiry_date
                )
                commit_payload = CheckInCommitPayload(
                    name_th=draft_res.name_th,
                    name_en=draft_res.name_en,
                    category=draft_res.category,
                    category_th=draft_res.category_th,
                    estimated_shelf_life_days=draft_res.estimated_shelf_life_days,
                    expiry_date=expiry,
                    storage_recommendation_th=draft_res.storage_recommendation_th,
                    storage_recommendation_en=draft_res.storage_recommendation_en,
                    image_storage_path=draft_res.image_storage_path,
                    confidence=draft_res.confidence,
                )
                commit_ok, commit_res, _ = self.client.checkin_commit(commit_payload)
                if commit_ok and commit_res is not None:
                    self.queue.delete_checkin(int(chk["id"]))
                    try:
                        img_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                    counts["checkins"] += 1
                    self._is_online = True
                else:
                    self._is_online = False
                    break
            else:
                self._is_online = False
                break

        total = sum(counts.values())
        if total > 0:
            logger.info("Flushed %d items from offline queue: %s", total, counts)
        return counts

    # ==========================================================================
    # Background Thread Loop
    # ==========================================================================

    def start_background_sync(self, interval_s: float = 20.0) -> None:
        """Starts background flusher thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._sync_loop,
            args=(interval_s,),
            daemon=True,
            name="CloudSyncManager",
        )
        self._thread.start()
        logger.info("Cloud background sync thread started (interval=%.1fs)", interval_s)

    def _sync_loop(self, interval_s: float) -> None:
        backoff_s = interval_s
        while self._running:
            try:
                self.flush_offline_queue()
                if self._is_online:
                    backoff_s = interval_s
                else:
                    backoff_s = min(backoff_s * 1.5, 60.0)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error in background sync loop: %s", exc)
                backoff_s = min(backoff_s * 1.5, 60.0)

            time.sleep(backoff_s)

    def stop_background_sync(self) -> None:
        """Stops background flusher."""
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("Cloud background sync stopped")
