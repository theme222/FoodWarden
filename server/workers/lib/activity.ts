const pageSize = 15;
const sources = {
  inventory: {
    table: "inventory_activity",
    columns: "action, name_th, name_en, source",
  },
  door: { table: "door_events", columns: "node_id, status" },
  sensor: {
    table: "telemetry_samples",
    columns: "node_id, temp_celsius, voc_index, light_ldr",
  },
} as const;

interface ActivityRow {
  id: number;
  timestamp_s: number;
}

export async function listActivity(
  db: D1Database,
  fridgeId: string,
  kind: string | undefined,
  date: string | undefined,
  cursor: string | undefined,
) {
  if (kind !== "inventory" && kind !== "door" && kind !== "sensor") return null;
  const source = sources[kind];
  const where = ["fridge_id = ?"];
  const bindings: (string | number)[] = [fridgeId];

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const utc = Date.parse(date + "T00:00:00Z");
    if (
      !Number.isFinite(utc) ||
      new Date(utc).toISOString().slice(0, 10) !== date
    )
      return null;
    const start = utc / 1000 - 7 * 3600;
    where.push("timestamp_s >= ? AND timestamp_s < ?");
    bindings.push(start, start + 86400);
  }

  if (cursor) {
    const match = /^(\d{1,15})\.(\d{1,16})$/.exec(cursor);
    if (!match) return null;
    const timestamp = Number(match[1]);
    const id = Number(match[2]);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    where.push("(timestamp_s, rowid) < (?, ?)");
    bindings.push(timestamp, id);
  }

  const { results } = await db
    .prepare(
      `SELECT rowid AS id, timestamp_s, ${source.columns}
     FROM ${source.table} WHERE ${where.join(" AND ")}
     ORDER BY timestamp_s DESC, rowid DESC LIMIT ?`,
    )
    .bind(...bindings, pageSize + 1)
    .all<ActivityRow>();
  const rows = results.slice(0, pageSize);
  const last = rows.at(-1);
  return {
    rows,
    next:
      last && results.length > pageSize
        ? last.timestamp_s + "." + last.id
        : null,
  };
}
