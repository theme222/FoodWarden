"""Structured [TIMING] log emitter matching interface/TIMING.md.

Provides monotonic microsecond timestamps (time.perf_counter_ns() // 1000)
unaffected by NTP/wall-clock resyncs, formatted as single-line ASCII records
so the Pi-top latency collector can filter them out from normal debug logs.
"""

from __future__ import annotations

import logging
import time
from typing import Any

TIMING_PREFIX = "[TIMING]"
_timing_logger = logging.getLogger("foodwarden_camera.timing")


def monotonic_us() -> int:
    """Returns local monotonic timestamp in microseconds."""
    return time.perf_counter_ns() // 1000


def format_timing_line(
    evt: str,
    *,
    node_id: str = "C0",
    t_us: int | None = None,
    **fields: Any,
) -> str:
    """Formats a canonical [TIMING] record per interface/TIMING.md §1."""
    ts = monotonic_us() if t_us is None else int(t_us)
    parts = [TIMING_PREFIX, f"node={node_id}", f"evt={evt}", f"t_us={ts}"]
    for key, val in fields.items():
        if val is None:
            formatted = "-"
        elif isinstance(val, bool):
            formatted = "1" if val else "0"
        elif isinstance(val, float):
            formatted = f"{val:.2f}"
        else:
            formatted = str(val).replace(" ", "_")
        parts.append(f"{key}={formatted}")
    return " ".join(parts)


def log_timing(
    evt: str,
    *,
    node_id: str = "C0",
    t_us: int | None = None,
    **fields: Any,
) -> str:
    """Emits a [TIMING] record to the logger at INFO level and returns the line."""
    line = format_timing_line(evt, node_id=node_id, t_us=t_us, **fields)
    _timing_logger.info("%s", line)
    return line
