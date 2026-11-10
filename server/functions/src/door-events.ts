import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { findGatewayFridge } from "./gateway";

const STATUSES = [
  "CLOSING", "SUCCESS", "OBSTRUCTION_ERROR", "ABORTED", "TIMEOUT_ERROR",
  "FAULT_LOCKOUT", "CONTRADICTION_ERROR",
] as const;

interface DoorEvent {
  node_id: string;
  timestamp_s: number;
  status: (typeof STATUSES)[number];
}

// Local mirror of CBS section 3.6. One bounded transaction accepts the whole batch.
export function parseDoorEvents(body: unknown): DoorEvent[] | null {
  if (typeof body !== "object" || body === null || !("events" in body) ||
      !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 499) return null;
  const events: DoorEvent[] = [];
  for (const value of body.events as unknown[]) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const event = value as Record<string, unknown>;
    const { node_id, timestamp_s, status } = event;
    const validStatus = STATUSES.find((candidate) => candidate === status);
    if (typeof node_id !== "string" || !node_id.trim() || node_id !== node_id.trim() ||
        node_id.length > 128 || typeof timestamp_s !== "number" ||
        !Number.isSafeInteger(timestamp_s) || timestamp_s < 0 || timestamp_s > 253402300799 ||
        !validStatus) return null;
    events.push({ node_id, timestamp_s, status: validStatus });
  }
  return events;
}

export async function ingestDoorEvents(
  firestore: Firestore,
  tokenHash: string,
  events: DoorEvent[],
): Promise<number | null> {
  return firestore.runTransaction(async (transaction) => {
    const fridge = await findGatewayFridge(firestore, transaction, tokenHash);
    if (!fridge) return null;
    // Preserve distinct transitions and nodes in the same second while making retries idempotent.
    const unique = new Map(events.map((event) => [createHash("sha256")
      .update(JSON.stringify([event.node_id, event.timestamp_s, event.status])).digest("hex"), event]));
    const refs = [...unique.keys()].map((id) => fridge.collection("door_events").doc(id));
    const [parent, ...stored] = await transaction.getAll(fridge, ...refs);
    if (!parent?.exists) return null;
    let count = 0;
    for (const snapshot of stored) {
      if (snapshot.exists) continue;
      transaction.create(snapshot.ref, { ...unique.get(snapshot.id) });
      count += 1;
    }
    return count;
  });
}
