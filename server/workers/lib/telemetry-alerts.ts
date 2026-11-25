import type { TelemetrySample } from "./telemetry";

const WINDOW_S = 900;
const MAX_SAMPLE_GAP_S = 360;

function sustained(
  rows: TelemetrySample[],
  threshold: (sample: TelemetrySample) => boolean,
) {
  const newest = rows[0];
  if (!newest || !threshold(newest)) return false;
  let previousS = newest.timestamp_s;
  for (const row of rows.slice(1)) {
    if (previousS - row.timestamp_s > MAX_SAMPLE_GAP_S || !threshold(row))
      return false;
    if (newest.timestamp_s - row.timestamp_s >= WINDOW_S) return true;
    previousS = row.timestamp_s;
  }
  return false;
}

export async function sustainedAlertSamples(
  db: D1Database,
  fridgeId: string,
  accepted: TelemetrySample[],
  nowS: number,
): Promise<TelemetrySample[]> {
  const latestByNode = new Map<string, TelemetrySample>();
  for (const sample of accepted) {
    if (
      sample.timestamp_s > nowS ||
      nowS - sample.timestamp_s > MAX_SAMPLE_GAP_S
    )
      continue;
    const existing = latestByNode.get(sample.node_id);
    if (!existing || sample.timestamp_s > existing.timestamp_s)
      latestByNode.set(sample.node_id, sample);
  }
  const candidates = [...latestByNode.values()].filter(
    (sample) =>
      (sample.temp_celsius ?? -Infinity) > 8 ||
      (sample.voc_index ?? -Infinity) >= 250,
  );
  const results: TelemetrySample[] = [];
  for (const candidate of candidates) {
    const { results: rows } = await db
      .prepare(
        `SELECT node_id, timestamp_s, temp_celsius, voc_index, light_ldr FROM telemetry_samples
       WHERE fridge_id=? AND node_id=? AND timestamp_s BETWEEN ? AND ?
       ORDER BY timestamp_s DESC`,
      )
      .bind(
        fridgeId,
        candidate.node_id,
        candidate.timestamp_s - WINDOW_S - MAX_SAMPLE_GAP_S,
        nowS,
      )
      .all<TelemetrySample>();
    if (rows[0]?.timestamp_s !== candidate.timestamp_s) continue;
    const temp = sustained(rows, (row) => (row.temp_celsius ?? -Infinity) > 8);
    const voc = sustained(rows, (row) => (row.voc_index ?? -Infinity) >= 250);
    if (temp || voc)
      results.push({
        ...candidate,
        temp_celsius: temp ? candidate.temp_celsius : null,
        voc_index: voc ? candidate.voc_index : null,
      });
  }
  return results;
}

function bangkokMidnight(nowS: number) {
  return Math.floor((nowS + 7 * 3600) / 86400) * 86400 - 7 * 3600;
}

export async function previousDaySensorAlerts(
  db: D1Database,
  fridgeId: string,
  nowS: number,
  userId?: string,
): Promise<number> {
  const midnight = bangkokMidnight(nowS);
  const source =
    userId === undefined
      ? "line_alert_events WHERE fridge_id=? AND alert_type IN ('temp_high','voc_high')"
      : "user_line_events WHERE fridge_id=? AND user_id=? AND alert_type IN ('warm','spoil')";
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT event_key) AS n FROM ${source}
     AND CASE WHEN json_valid(event_key) THEN json_extract(event_key,'$[1]') END >= ?
     AND CASE WHEN json_valid(event_key) THEN json_extract(event_key,'$[1]') END < ?`,
    )
    .bind(
      fridgeId,
      ...(userId === undefined ? [] : [userId]),
      midnight - 86400,
      midnight,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function previousDayDoorFaults(
  db: D1Database,
  fridgeId: string,
  nowS: number,
): Promise<number> {
  const midnight = bangkokMidnight(nowS);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM door_events WHERE fridge_id=? AND timestamp_s>=? AND timestamp_s<?
    AND status IN ('OBSTRUCTION_ERROR','TIMEOUT_ERROR','FAULT_LOCKOUT','CONTRADICTION_ERROR')`,
    )
    .bind(fridgeId, midnight - 86400, midnight)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
