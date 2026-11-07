"""Local SQLite Store-and-Forward Queue for Rubric E4 (Reliable Communication).

Buffers telemetry, door events, and pending grocery check-in images during internet
or cloud disconnects, and drains with exponential backoff upon reconnection.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from foodwarden_camera.models.ble_fuc import SensorSample


class OfflineQueue:
    """Manages SQLite storage for offline data buffering."""

    def __init__(self, db_path: str = "foodwarden_gateway.db") -> None:
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Initializes tables if they do not exist."""
        # Ensure parent directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            # 1. Telemetry Queue
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS offline_telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    timestamp_s INTEGER NOT NULL,
                    temp_cdeg REAL,
                    voc_index INTEGER,
                    light_ldr INTEGER,
                    created_at INTEGER NOT NULL,
                    attempts INTEGER DEFAULT 0
                )
                """
            )

            # 2. Door Event Queue
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS offline_door_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    details_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    attempts INTEGER DEFAULT 0
                )
                """
            )

            # 3. Offline Check-In Queue
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS offline_checkin (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    image_path TEXT NOT NULL,
                    captured_at INTEGER NOT NULL,
                    confirmed_expiry TEXT,
                    status TEXT DEFAULT 'PENDING',
                    created_at INTEGER NOT NULL,
                    attempts INTEGER DEFAULT 0
                )
                """
            )
            conn.commit()

    # ==========================================================================
    # Telemetry Queue Operations
    # ==========================================================================

    def enqueue_telemetry(self, node_id: str, sample: SensorSample) -> int:
        """Enqueues a single telemetry sample."""
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO offline_telemetry (
                    node_id, timestamp_s, temp_cdeg, voc_index, light_ldr, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    node_id,
                    sample.timestamp_s,
                    sample.temp_celsius,
                    sample.voc_index,
                    sample.light_ldr,
                    now,
                ),
            )
            conn.commit()
            return int(cursor.lastrowid or 0)

    def enqueue_telemetry_batch(self, node_id: str, samples: list[SensorSample]) -> int:
        """Enqueues multiple telemetry samples in a single transaction."""
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            rows = [
                (node_id, s.timestamp_s, s.temp_celsius, s.voc_index, s.light_ldr, now)
                for s in samples
            ]
            cursor.executemany(
                """
                INSERT INTO offline_telemetry (
                    node_id, timestamp_s, temp_cdeg, voc_index, light_ldr, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            return len(rows)

    def get_pending_telemetry(self, limit: int = 50) -> list[dict[str, Any]]:
        """Retrieves oldest pending telemetry items up to limit."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, node_id, timestamp_s, temp_cdeg, voc_index, light_ldr, attempts
                FROM offline_telemetry
                ORDER BY timestamp_s ASC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def delete_telemetry(self, ids: list[int]) -> int:
        """Acknowledges and removes synced telemetry records."""
        if not ids:
            return 0
        with self._get_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" * len(ids))
            cursor.execute(
                f"DELETE FROM offline_telemetry WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()
            return cursor.rowcount

    # ==========================================================================
    # Door Event Queue Operations
    # ==========================================================================

    def enqueue_door_event(
        self,
        node_id: str,
        event_type: str,
        timestamp: int,
        details: dict[str, Any],
    ) -> int:
        """Enqueues an unforwarded door event."""
        now = int(time.time())
        details_json = json.dumps(details)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO offline_door_events (
                    node_id, event_type, timestamp, details_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (node_id, event_type, timestamp, details_json, now),
            )
            conn.commit()
            return int(cursor.lastrowid or 0)

    def get_pending_door_events(self, limit: int = 50) -> list[dict[str, Any]]:
        """Retrieves unforwarded door events."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, node_id, event_type, timestamp, details_json, attempts
                FROM offline_door_events
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            results = []
            for row in rows:
                item = dict(row)
                item["details"] = json.loads(item.pop("details_json"))
                results.append(item)
            return results

    def delete_door_events(self, ids: list[int]) -> int:
        """Acknowledges and removes forwarded door event records."""
        if not ids:
            return 0
        with self._get_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" * len(ids))
            cursor.execute(
                f"DELETE FROM offline_door_events WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()
            return cursor.rowcount

    # ==========================================================================
    # Offline Grocery Check-In Queue Operations
    # ==========================================================================

    def enqueue_checkin(
        self,
        image_path: str,
        captured_at: int,
        confirmed_expiry: str | None = None,
    ) -> int:
        """Enqueues an offline grocery check-in capture."""
        now = int(time.time())
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO offline_checkin (
                    image_path, captured_at, confirmed_expiry, status, created_at
                ) VALUES (?, ?, ?, 'PENDING', ?)
                """,
                (image_path, captured_at, confirmed_expiry, now),
            )
            conn.commit()
            return int(cursor.lastrowid or 0)

    def get_pending_checkins(self, limit: int = 10) -> list[dict[str, Any]]:
        """Retrieves pending offline grocery check-in captures."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, image_path, captured_at, confirmed_expiry, status, attempts
                FROM offline_checkin
                WHERE status = 'PENDING'
                ORDER BY captured_at ASC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def delete_checkin(self, checkin_id: int) -> int:
        """Deletes finalized checkin from queue."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM offline_checkin WHERE id = ?", (checkin_id,))
            conn.commit()
            return cursor.rowcount
