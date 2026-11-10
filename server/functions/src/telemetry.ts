import type { Firestore } from "firebase-admin/firestore";
import { findGatewayFridge } from "./gateway";

interface TelemetrySample {
  node_id: string;
  timestamp_s: number;
  temp_celsius: number | null;
  voc_index: number | null;
  light_ldr: number | null;
}

const MAX_TIMESTAMP_S = 253402300799; // Last second of year 9999 in UTC.
const MAX_BUCKETS_PER_BATCH = 499; // Reserve one transaction write for the fridge document.
const MAX_SAMPLES_PER_BATCH = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function parseSample(value: unknown): TelemetrySample | null {
  if (!isRecord(value)) return null;

  const { node_id, timestamp_s, temp_celsius, voc_index, light_ldr } = value;
  if (
    typeof node_id !== "string" || !node_id.trim() || node_id.length > 128 ||
    node_id !== node_id.trim() ||
    typeof timestamp_s !== "number" || !Number.isInteger(timestamp_s) ||
    timestamp_s < 0 || timestamp_s > MAX_TIMESTAMP_S ||
    !isNullableNumber(temp_celsius) ||
    !isNullableNumber(voc_index) ||
    !isNullableNumber(light_ldr)
  ) {
    return null;
  }
  return { node_id, timestamp_s, temp_celsius, voc_index, light_ldr };
}

export function parseTelemetry(body: unknown): Map<string, TelemetrySample[]> | null {
  if (!isRecord(body) || !Array.isArray(body.samples) || body.samples.length === 0 ||
      body.samples.length > MAX_SAMPLES_PER_BATCH) return null;

  const buckets = new Map<string, TelemetrySample[]>();
  for (const rawSample of body.samples) {
    const sample = parseSample(rawSample);
    if (!sample) return null;

    const minute = new Date(sample.timestamp_s * 1000).toISOString().slice(0, 16);
    const bucketId = minute.replace(/[-:]/g, "").replace("T", "_");
    const bucket = buckets.get(bucketId);
    if (bucket) {
      bucket.push(sample);
    } else {
      buckets.set(bucketId, [sample]);
      if (buckets.size > MAX_BUCKETS_PER_BATCH) return null;
    }
  }

  return buckets.size <= MAX_BUCKETS_PER_BATCH ? buckets : null;
}

export async function ingestTelemetry(
  firestore: Firestore,
  tokenHash: string,
  buckets: Map<string, TelemetrySample[]>,
): Promise<number | null> {
  return firestore.runTransaction(async (transaction) => {
    const fridgeRef = await findGatewayFridge(firestore, transaction, tokenHash);
    if (!fridgeRef) return null;

    const bucketRefs = [...buckets.keys()].map((id) =>
      fridgeRef.collection("telemetry_minute").doc(id),
    );
    const [fridge, ...snapshots] = await transaction.getAll(fridgeRef, ...bucketRefs);
    if (!fridge?.exists) return null;

    let ingestedCount = 0;
    let newestSample: TelemetrySample | undefined;
    for (const snapshot of snapshots) {
      const previous: unknown = snapshot.get("samples");
      const samples: unknown[] = Array.isArray(previous) ? [...previous] : [];
      const timestamps = new Set(
        samples.filter(isRecord).map((sample) => sample.timestamp_s),
      );

      for (const sample of buckets.get(snapshot.id) ?? []) {
        if (timestamps.has(sample.timestamp_s)) continue;

        timestamps.add(sample.timestamp_s);
        samples.push(sample);
        ingestedCount += 1;
        if (!newestSample || sample.timestamp_s > newestSample.timestamp_s) {
          newestSample = sample;
        }
      }

      if (!Array.isArray(previous) || samples.length !== previous.length) {
        transaction.set(snapshot.ref, { bucket_minute: snapshot.id, samples }, { merge: true });
      }
    }

    const previousContact: unknown = fridge.get("last_seen_s");
    const lastSeen = Math.max(
      Math.floor(Date.now() / 1000),
      typeof previousContact === "number" ? previousContact : 0,
    );
    const cachedTimestamp: unknown = fridge.get("last_telemetry.timestamp_s");
    if (newestSample && (typeof cachedTimestamp !== "number" || newestSample.timestamp_s > cachedTimestamp)) {
      transaction.update(fridgeRef, { last_seen_s: lastSeen, last_telemetry: newestSample });
    } else if (previousContact !== lastSeen) {
      transaction.update(fridgeRef, { last_seen_s: lastSeen });
    }

    return ingestedCount;
  });
}
