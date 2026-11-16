import { eventTimeIsValid } from "./event-time";
export const DOOR_EVENT_STATUSES = [
  "CLOSING",
  "SUCCESS",
  "OBSTRUCTION_ERROR",
  "ABORTED",
  "TIMEOUT_ERROR",
  "FAULT_LOCKOUT",
  "CONTRADICTION_ERROR",
] as const;

export type DoorEventStatus = (typeof DOOR_EVENT_STATUSES)[number];

export interface DoorEvent {
  node_id: string;
  timestamp_s: number;
  status: DoorEventStatus;
}

const MAX_EVENTS_PER_BATCH = 499;

export function parseDoorEvents(
  body: unknown,
  nowS = Math.floor(Date.now() / 1000),
): DoorEvent[] | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("events" in body) ||
    !Array.isArray(body.events) ||
    body.events.length === 0 ||
    body.events.length > MAX_EVENTS_PER_BATCH
  ) {
    return null;
  }

  const events: DoorEvent[] = [];
  for (const value of body.events as unknown[]) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const event = value as Record<string, unknown>;
    const { node_id, timestamp_s, status } = event;
    const validStatus = DOOR_EVENT_STATUSES.find(
      (candidate) => candidate === status,
    );
    if (
      typeof node_id !== "string" ||
      !node_id.trim() ||
      node_id !== node_id.trim() ||
      node_id.length > 128 ||
      typeof timestamp_s !== "number" ||
      !Number.isSafeInteger(timestamp_s) ||
      !eventTimeIsValid(timestamp_s, nowS) ||
      !validStatus
    ) {
      return null;
    }
    events.push({ node_id, timestamp_s, status: validStatus });
  }
  return events;
}

export async function ingestDoorEvents(
  db: D1Database,
  fridgeId: string,
  events: DoorEvent[],
  nowS: number,
): Promise<number> {
  if (events.some((event) => !eventTimeIsValid(event.timestamp_s, nowS)))
    throw new Error("INVALID_EVENT_TIME");
  const unique = new Map<string, DoorEvent>();
  for (const event of events) {
    const key = `${event.node_id}\u0000${event.timestamp_s}\u0000${event.status}`;
    if (!unique.has(key)) {
      unique.set(key, event);
    }
  }

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO door_events (fridge_id, node_id, timestamp_s, status)
     VALUES (?, ?, ?, ?)`,
  );
  const statements = [...unique.values()].map((event) =>
    insertStmt.bind(fridgeId, event.node_id, event.timestamp_s, event.status),
  );
  const touchFridgeStmt = db
    .prepare(
      "UPDATE fridges SET last_seen_s = MAX(last_seen_s, ?) WHERE id = ?",
    )
    .bind(nowS, fridgeId);

  const results = await db.batch([...statements, touchFridgeStmt]);
  let ingestedCount = 0;
  for (let i = 0; i < statements.length; i += 1) {
    ingestedCount += results[i]?.meta.changes ?? 0;
  }
  return ingestedCount;
}
