"""Cloud Sync Manager implementing Rubric E4 Store-and-Forward.

Coordinates real-time cloud communications with local SQLite offline buffering,
flushing pending queues with exponential backoff whenever network connectivity is restored.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from foodwarden_camera.cloud.client import CloudClient, classify_cloud_error
from foodwarden_camera.models.ble_fuc import SensorSample
from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    DoorEventItem,
    DoorEventSyncPayload,
    NodeStatusItem,
    StatusPayload,
    TelemetrySamplePayload,
    TelemetrySyncPayload,
    normalize_door_event_status,
    normalize_event_timestamp,
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
        status_interval_s: float = 60.0,
    ) -> None:
        self.client = cloud_client
        self.queue = offline_queue
        self.captures_dir = Path(captures_dir)
        self.captures_dir.mkdir(parents=True, exist_ok=True)
        self.status_interval_s = status_interval_s

        self._running: bool = False
        self._thread: threading.Thread | None = None
        self._is_online: bool = True
        self._lock = threading.Lock()
        self._node_last_seen: dict[str, int | None] = {"F0": None, "D0": None}
        self._last_status_sent_at: float = 0.0

    @property
    def is_online(self) -> bool:
        return self._is_online

    # ==========================================================================
    # Node Heartbeat Tracking (CBS.md §3.7)
    # ==========================================================================

    def record_node_seen(self, node_id: str, timestamp_s: int | None = None) -> None:
        """Records latest contact timestamp for a hardware component."""
        now_s = int(time.time())
        if timestamp_s is None or timestamp_s < 1_600_000_000:
            ts = now_s
        else:
            ts = min(int(timestamp_s), now_s)
        with self._lock:
            prev = self._node_last_seen.get(node_id)
            if prev is None or ts > prev:
                self._node_last_seen[node_id] = ts

    def send_status_heartbeat(self, gateway_node_id: str = "C0") -> bool:
        """Dispatches component status heartbeat to Server 'S' per CBS.md §3.7."""
        now_s = int(time.time())
        with self._lock:
            nodes_snapshot: dict[str, int | None] = {gateway_node_id: now_s}
            for node_id, last_seen in self._node_last_seen.items():
                if node_id != gateway_node_id:
                    nodes_snapshot[node_id] = last_seen

        payload = StatusPayload(
            nodes=[
                NodeStatusItem(node_id=node_id, last_seen_s=last_seen)
                for node_id, last_seen in nodes_snapshot.items()
            ]
        )
        ok = self.client.sync_status(payload)
        self._is_online = ok
        return ok

    # ==========================================================================
    # Real-Time or Offline Enqueue
    # ==========================================================================

    def send_or_enqueue_telemetry(self, node_id: str, sample: SensorSample) -> bool:
        """Attempts real-time cloud sync for one sample; buffers to SQLite if offline."""
        return self.send_or_enqueue_telemetry_batch(node_id, [sample])

    def send_or_enqueue_telemetry_batch(self, node_id: str, samples: list[SensorSample]) -> bool:
        """Attempts real-time cloud sync for batched samples; buffers to SQLite if offline."""
        if not samples:
            return True

        sample_items = [
            TelemetrySamplePayload(
                node_id=node_id,
                timestamp_s=normalize_event_timestamp(sample.timestamp_s),
                temp_celsius=sample.temp_celsius,
                voc_index=sample.voc_index,
                light_ldr=sample.light_ldr,
            )
            for sample in samples
        ]
        payload = TelemetrySyncPayload(samples=sample_items)

        success = self.client.sync_telemetry(payload)
        if success:
            self._is_online = True
            return True

        # Failed: buffer to SQLite
        self._is_online = False
        self.queue.enqueue_telemetry_batch(node_id, samples)
        logger.info(
            "Buffered %d telemetry sample(s) from %s to offline queue", len(samples), node_id
        )
        return False

    def send_or_enqueue_door_event(
        self,
        node_id: str,
        event_type: str,
        timestamp: int,
        details: dict[str, Any],
    ) -> bool:
        """Attempts real-time cloud sync; buffers to SQLite if offline."""
        norm_ts = normalize_event_timestamp(timestamp)
        payload = DoorEventSyncPayload(
            node_id=node_id,
            event_type=event_type,
            timestamp=norm_ts,
            details=details,
        )
        success = self.client.sync_door_event(payload)
        if success:
            self._is_online = True
            return True

        # Failed: buffer to SQLite
        self._is_online = False
        self.queue.enqueue_door_event(node_id, event_type, norm_ts, details)
        logger.info("Buffered door event %s to offline queue", event_type)
        return False

    def enqueue_offline_checkin(
        self,
        image_bytes: bytes,
        confirmed_expiry: str | None = None,
        draft_idempotency_key: str | None = None,
        commit_idempotency_key: str | None = None,
    ) -> int:
        """Saves image to disk and enqueues offline check-in record with persistent keys."""
        now = int(time.time())
        filename = f"offline_checkin_{now}_{uuid.uuid4().hex[:6]}.jpg"
        file_path = self.captures_dir / filename

        with open(file_path, "wb") as f:
            f.write(image_bytes)

        checkin_id = self.queue.enqueue_checkin(
            image_path=str(file_path),
            captured_at=now,
            confirmed_expiry=confirmed_expiry,
            draft_idempotency_key=draft_idempotency_key,
            commit_idempotency_key=commit_idempotency_key,
        )
        logger.info("Enqueued offline grocery check-in: id=%d, file=%s", checkin_id, file_path)
        return checkin_id

    def enqueue_pending_commit(
        self,
        payload: CheckInCommitPayload,
        commit_idempotency_key: str,
    ) -> int:
        """Enqueues a finalized check-in commit payload with its original Idempotency-Key."""
        return self.queue.enqueue_checkin(
            image_path="",
            captured_at=int(time.time()),
            confirmed_expiry=payload.estimated_expiry_date,
            commit_idempotency_key=commit_idempotency_key,
            draft_json=payload.model_dump_json(),
        )

    # ==========================================================================
    # Queue Draining / Flush Operations
    # ==========================================================================

    def flush_offline_queue(self) -> dict[str, int]:
        """Drains pending SQLite records to cloud server.

        Returns:
            Dictionary of synced count per category.
        """
        counts = {"telemetry": 0, "door_events": 0, "checkins": 0}

        # 1. Flush Pending Telemetry in Batches (CBS.md §3.5)
        pending_telemetry = self.queue.get_pending_telemetry(limit=100)
        if pending_telemetry:
            sample_items = [
                TelemetrySamplePayload(
                    node_id=str(r["node_id"]),
                    timestamp_s=normalize_event_timestamp(int(r["timestamp_s"])),
                    temp_celsius=float(r["temp_cdeg"]) if r["temp_cdeg"] is not None else None,
                    voc_index=int(r["voc_index"]) if r["voc_index"] is not None else None,
                    light_ldr=int(r["light_ldr"]) if r["light_ldr"] is not None else None,
                )
                for r in pending_telemetry
            ]
            payload = TelemetrySyncPayload(samples=sample_items)
            if self.client.sync_telemetry(payload):
                synced_ids = [int(r["id"]) for r in pending_telemetry]
                self.queue.delete_telemetry(synced_ids)
                counts["telemetry"] += len(synced_ids)
                self._is_online = True
            else:
                self._is_online = False

        # 2. Flush Pending Door Events in Batches (CBS.md §3.6)
        pending_events = self.queue.get_pending_door_events(limit=50)
        if len(pending_events) == 1:
            evt = pending_events[0]
            event_payload = DoorEventSyncPayload(
                node_id=str(evt["node_id"]),
                event_type=str(evt["event_type"]),
                timestamp=normalize_event_timestamp(int(evt["timestamp"])),
                details=dict(evt["details"]),
            )
            if self.client.sync_door_event(event_payload):
                self.queue.delete_door_events([int(evt["id"])])
                counts["door_events"] += 1
                self._is_online = True
            else:
                self._is_online = False
        elif len(pending_events) > 1:
            event_items = [
                DoorEventItem(
                    node_id=str(evt["node_id"]),
                    timestamp_s=normalize_event_timestamp(int(evt["timestamp"])),
                    status=normalize_door_event_status(str(evt["event_type"])),
                )
                for evt in pending_events
            ]
            if self.client.sync_door_events_batch(event_items):
                synced_evt_ids = [int(evt["id"]) for evt in pending_events]
                self.queue.delete_door_events(synced_evt_ids)
                counts["door_events"] += len(synced_evt_ids)
                self._is_online = True
            else:
                self._is_online = False

        # 3. Flush Pending Offline Check-Ins (E4 & Goal.md §3)
        pending_checkins = self.queue.get_pending_checkins(limit=5)
        for chk in pending_checkins:
            draft_key = str(chk.get("draft_idempotency_key") or uuid.uuid4())
            commit_key = str(chk.get("commit_idempotency_key") or uuid.uuid4())
            raw_img_path = str(chk.get("image_path") or "")
            img_path = Path(raw_img_path) if raw_img_path else None

            raw_draft_json = chk.get("draft_json")
            if raw_draft_json:
                commit_payload = CheckInCommitPayload.model_validate_json(str(raw_draft_json))
            else:
                if img_path is None or not img_path.exists():
                    logger.warning(
                        "Offline check-in image missing: %s; deleting record", raw_img_path
                    )
                    self.queue.delete_checkin(int(chk["id"]))
                    continue

                with open(img_path, "rb") as f:
                    img_bytes = f.read()

                draft_ok, draft_res, draft_err = self.client.checkin_draft(
                    img_bytes,
                    idempotency_key=draft_key,
                )
                if not (draft_ok and draft_res is not None):
                    draft_err_kind = classify_cloud_error(draft_err)
                    if draft_err_kind in ("unidentifiable", "rejected"):
                        logger.warning(
                            "Dropping permanently rejected offline check-in id=%s (%s)",
                            chk["id"],
                            draft_err,
                        )
                        self.queue.delete_checkin(int(chk["id"]))
                        try:
                            img_path.unlink(missing_ok=True)
                        except OSError:
                            pass
                        self._is_online = True
                        continue
                    self._is_online = draft_err_kind in ("auth", "rate_limited")
                    break

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
                    estimated_expiry_date=expiry,
                    storage_recommendation_th=draft_res.storage_recommendation_th,
                    storage_recommendation_en=draft_res.storage_recommendation_en,
                    image_storage_path=draft_res.image_storage_path,
                    confidence=draft_res.confidence,
                )
                self.queue.save_checkin_draft(
                    int(chk["id"]),
                    commit_payload.model_dump_json(),
                    expiry,
                )

            commit_ok, commit_res, commit_err = self.client.checkin_commit(
                commit_payload,
                idempotency_key=commit_key,
            )
            if commit_ok and commit_res is not None:
                self.queue.delete_checkin(int(chk["id"]))
                if img_path is not None:
                    try:
                        img_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                counts["checkins"] += 1
                self._is_online = True
            else:
                commit_err_kind = classify_cloud_error(commit_err)
                if commit_err_kind in ("unidentifiable", "rejected"):
                    logger.warning(
                        "Dropping permanently rejected offline commit id=%s (%s)",
                        chk["id"],
                        commit_err,
                    )
                    self.queue.delete_checkin(int(chk["id"]))
                    if img_path is not None:
                        try:
                            img_path.unlink(missing_ok=True)
                        except OSError:
                            pass
                    self._is_online = True
                    continue
                self._is_online = commit_err_kind in ("auth", "rate_limited")
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
        next_status_at = time.monotonic()
        while self._running:
            try:
                now_mono = time.monotonic()
                if now_mono >= next_status_at:
                    self.send_status_heartbeat()
                    self._last_status_sent_at = now_mono
                    while next_status_at <= now_mono:
                        next_status_at += self.status_interval_s

                self.flush_offline_queue()
                if self._is_online:
                    backoff_s = interval_s
                else:
                    backoff_s = min(backoff_s * 1.5, 60.0)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error in background sync loop: %s", exc)
                backoff_s = min(backoff_s * 1.5, 60.0)

            remaining_status_s = max(0.05, next_status_at - time.monotonic())
            time.sleep(min(backoff_s, remaining_status_s))

    def stop_background_sync(self) -> None:
        """Stops background flusher."""
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("Cloud background sync stopped")
