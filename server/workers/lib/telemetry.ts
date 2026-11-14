export interface TelemetrySample {
  node_id: string;
  timestamp_s: number;
  temp_celsius: number | null;
  voc_index: number | null;
  light_ldr: number | null;
}

const MAX_TIMESTAMP_S = 253_402_300_799; // Last second of year 9999 in UTC.
const MAX_SAMPLES_PER_BATCH = 10_000;
const D1_BATCH_CHUNK_SIZE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function parseSample(value: unknown): TelemetrySample | null {
  if (!isRecord(value)) return null;
  const { node_id, timestamp_s, temp_celsius, voc_index, light_ldr } = value;
  if (
    typeof node_id !== "string" ||
    !node_id.trim() ||
    node_id.length > 128 ||
    node_id !== node_id.trim() ||
    typeof timestamp_s !== "number" ||
    !Number.isSafeInteger(timestamp_s) ||
    timestamp_s < 0 ||
    timestamp_s > MAX_TIMESTAMP_S ||
    !isNullableNumber(temp_celsius) ||
    !isNullableNumber(voc_index) ||
    !isNullableNumber(light_ldr)
  ) {
    return null;
  }
  return { node_id, timestamp_s, temp_celsius, voc_index, light_ldr };
}

export function parseTelemetry(body: unknown): TelemetrySample[] | null {
  if (
    !isRecord(body) ||
    !Array.isArray(body.samples) ||
    body.samples.length === 0 ||
    body.samples.length > MAX_SAMPLES_PER_BATCH
  ) {
    return null;
  }

  const samples: TelemetrySample[] = [];
  for (const rawSample of body.samples as unknown[]) {
    const sample = parseSample(rawSample);
    if (!sample) return null;
    samples.push(sample);
  }
  return samples;
}

export async function ingestTelemetry(
  db: D1Database,
  fridgeId: string,
  samples: TelemetrySample[],
  nowS: number,
): Promise<number> {
  // Deduplicate within the incoming payload by (node_id, timestamp_s), keeping the first seen reading.
  const unique = new Map<string, TelemetrySample>();
  let newestSample: TelemetrySample | undefined;
  for (const sample of samples) {
    const key = `${sample.node_id}\u0000${sample.timestamp_s}`;
    if (!unique.has(key)) {
      unique.set(key, sample);
    }
    if (!newestSample || sample.timestamp_s > newestSample.timestamp_s) {
      newestSample = sample;
    }
  }

  const deduped = [...unique.values()];
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO telemetry_samples
     (fridge_id, node_id, timestamp_s, temp_celsius, voc_index, light_ldr)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let ingestedCount = 0;
  for (let offset = 0; offset < deduped.length; offset += D1_BATCH_CHUNK_SIZE) {
    const chunk = deduped.slice(offset, offset + D1_BATCH_CHUNK_SIZE);
    const statements = chunk.map((sample) =>
      insertStmt.bind(
        fridgeId,
        sample.node_id,
        sample.timestamp_s,
        sample.temp_celsius,
        sample.voc_index,
        sample.light_ldr,
      ),
    );
    const results = await db.batch(statements);
    for (const result of results) {
      ingestedCount += result.meta.changes ?? 0;
    }
  }

  if (newestSample) {
    const newestJson = JSON.stringify(newestSample);
    await db
      .prepare(
        `UPDATE fridges
         SET last_seen_s = MAX(last_seen_s, ?),
             last_telemetry_json = CASE
               WHEN last_telemetry_json IS NULL
                 OR COALESCE(CAST(json_extract(last_telemetry_json, '$.timestamp_s') AS INTEGER), -1) < ?
               THEN ?
               ELSE last_telemetry_json
             END
         WHERE id = ?`,
      )
      .bind(nowS, newestSample.timestamp_s, newestJson, fridgeId)
      .run();
  }

  return ingestedCount;
}
