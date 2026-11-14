import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./lib/gateway";
import {
  buildFoodPhotoKey,
  deletePrivatePhoto,
  getPrivatePhoto,
  inventoryPhotoKey,
  isValidJpegBytes,
  putImmutablePhoto,
  toStoragePath,
} from "./lib/storage";
import { parseDoorEvents } from "./lib/door-events";
import { parseStatus } from "./lib/status";
import { parseTelemetry } from "./lib/telemetry";

interface TestEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  TEST_MIGRATIONS: D1Migration[];
}

function getTestEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function seedFridge(
  db: D1Database,
  fridgeId: string,
  token: string,
): Promise<void> {
  const nowS = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256Hex(token);
  await db.batch([
    db
      .prepare("INSERT INTO fridges (id, name, created_at_s) VALUES (?, ?, ?)")
      .bind(fridgeId, `Fridge ${fridgeId}`, nowS),
    db
      .prepare(
        "INSERT INTO fridge_secrets (fridge_id, gateway_token, gateway_token_hash, updated_at_s) VALUES (?, ?, ?, ?)",
      )
      .bind(fridgeId, token, tokenHash, nowS),
  ]);
}

describe("CBS gateway ingestion and private R2 storage", () => {
  beforeAll(async () => {
    const testEnv = getTestEnv();
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  it("validates telemetry, status, and door event payloads against CBS limits", () => {
    const sample = {
      node_id: "F0",
      timestamp_s: 0,
      temp_celsius: null,
      voc_index: null,
      light_ldr: null,
    };
    expect(parseTelemetry({ samples: [sample] })?.length).toBe(1);
    expect(parseTelemetry({ samples: Array(10_001).fill(sample) })).toBeNull();
    expect(
      parseTelemetry({ samples: [{ ...sample, node_id: "F".repeat(129) }] }),
    ).toBeNull();
    expect(
      parseTelemetry({ samples: [{ ...sample, temp_celsius: Number.NaN }] }),
    ).toBeNull();

    const c0 = { node_id: "C0", last_seen_s: 1000 };
    expect(parseStatus({ nodes: [c0] }, 1000)).not.toBeNull();
    expect(parseStatus({ nodes: [c0, c0] }, 1000)).toBeNull();
    expect(
      parseStatus({ nodes: [{ ...c0, last_seen_s: 1301 }] }, 1000),
    ).toBeNull();
    expect(
      parseStatus({ nodes: [{ ...c0, last_seen_s: null }] }, 1000),
    ).toBeNull();

    const event = {
      node_id: "D0",
      timestamp_s: 1792944005,
      status: "SUCCESS" as const,
    };
    expect(parseDoorEvents({ events: Array(499).fill(event) })?.length).toBe(
      499,
    );
    expect(parseDoorEvents({ events: Array(500).fill(event) })).toBeNull();
    expect(
      parseDoorEvents({ events: [{ ...event, status: "OPEN" }] }),
    ).toBeNull();
  });

  it("authenticates, deduplicates per (fridge_id, node_id, timestamp_s), and preserves newest telemetry", async () => {
    const { DB } = getTestEnv();
    const fridgeId = `tel-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    await seedFridge(DB, fridgeId, token);

    const send = (body: unknown, bearer?: string) =>
      exports.default.fetch("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });

    const sampleF0 = {
      node_id: "F0",
      timestamp_s: 1792944000,
      temp_celsius: 3.4,
      voc_index: 115,
      light_ldr: 128,
    };
    const sampleF1 = {
      node_id: "F1",
      timestamp_s: 1792944000,
      temp_celsius: 4.1,
      voc_index: null,
      light_ldr: 200,
    };

    expect(
      (await exports.default.fetch("http://localhost/api/telemetry")).status,
    ).toBe(405);
    expect((await send({ samples: [sampleF0] })).status).toBe(401);
    expect((await send({ samples: [sampleF0] }, "wrong-token")).status).toBe(
      403,
    );
    expect(
      (await send({ samples: [{ ...sampleF0, temp_celsius: "bad" }] }, token))
        .status,
    ).toBe(400);

    // Multi-node readings in the same second are both stored without dropping F1.
    const first = await send({ samples: [sampleF0, sampleF1] }, token);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, ingested_count: 2 });

    // Retrying the exact same samples is idempotent.
    const retry = await send({ samples: [sampleF0, sampleF1] }, token);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ success: true, ingested_count: 0 });

    // Older offline backfill inserts cleanly without overwriting newer last_telemetry_json.
    const backfill = { ...sampleF0, timestamp_s: sampleF0.timestamp_s - 60 };
    const older = await send({ samples: [backfill] }, token);
    expect(older.status).toBe(200);
    expect(await older.json()).toEqual({ success: true, ingested_count: 1 });

    const { results } = await DB.prepare(
      "SELECT node_id, timestamp_s FROM telemetry_samples WHERE fridge_id = ? ORDER BY timestamp_s ASC, node_id ASC",
    )
      .bind(fridgeId)
      .all<{ node_id: string; timestamp_s: number }>();
    expect(results).toEqual([
      { node_id: "F0", timestamp_s: sampleF0.timestamp_s - 60 },
      { node_id: "F0", timestamp_s: sampleF0.timestamp_s },
      { node_id: "F1", timestamp_s: sampleF0.timestamp_s },
    ]);

    const fridgeRow = await DB.prepare(
      "SELECT last_telemetry_json FROM fridges WHERE id = ?",
    )
      .bind(fridgeId)
      .first<{ last_telemetry_json: string | null }>();
    expect(JSON.parse(fridgeRow?.last_telemetry_json ?? "null")).toEqual(
      sampleF0,
    );
  });

  it("ingests status heartbeats, retains last_known_seen_s, and ignores stale heartbeats", async () => {
    const { DB } = getTestEnv();
    const fridgeId = `stat-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    await seedFridge(DB, fridgeId, token);

    const nowS = Math.floor(Date.now() / 1000);
    const send = (body: unknown) =>
      exports.default.fetch("http://localhost/api/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    const first = await send({
      nodes: [
        { node_id: "C0", last_seen_s: nowS - 10 },
        { node_id: "F0", last_seen_s: nowS - 20 },
      ],
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, updated_count: 2 });

    // Out-of-order / duplicate heartbeat is ignored.
    const stale = await send({
      nodes: [{ node_id: "C0", last_seen_s: nowS - 15 }],
    });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ success: true, updated_count: 0 });

    // Subsequent heartbeat with F0=null retains F0's last_known_seen_s.
    const next = await send({
      nodes: [
        { node_id: "C0", last_seen_s: nowS },
        { node_id: "F0", last_seen_s: null },
      ],
    });
    expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ success: true, updated_count: 2 });

    const row = await DB.prepare(
      "SELECT gateway_seen_s, nodes_json FROM system_status WHERE fridge_id = ?",
    )
      .bind(fridgeId)
      .first<{ gateway_seen_s: number; nodes_json: string }>();
    expect(row?.gateway_seen_s).toBe(nowS);
    expect(JSON.parse(row?.nodes_json ?? "[]")).toEqual([
      { node_id: "C0", last_seen_s: nowS, last_known_seen_s: nowS },
      { node_id: "F0", last_seen_s: null, last_known_seen_s: nowS - 20 },
    ]);
  });

  it("handles door events atomically, idempotently across concurrent retries, and scoped per fridge", async () => {
    const { DB } = getTestEnv();
    const fridgeId = `door-${crypto.randomUUID()}`;
    const otherId = `other-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    await seedFridge(DB, fridgeId, token);
    await seedFridge(DB, otherId, `tok-${crypto.randomUUID()}`);

    const send = (events: unknown, bearer: string | null = token) =>
      exports.default.fetch("http://localhost/api/door_events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ events }),
      });

    const event = { node_id: "D0", timestamp_s: 1792944005, status: "CLOSING" };
    expect(
      (await exports.default.fetch("http://localhost/api/door_events")).status,
    ).toBe(405);
    expect((await send([event], null)).status).toBe(401);
    expect((await send([event], "bad")).status).toBe(403);
    expect((await send([event, { ...event, status: "INVALID" }])).status).toBe(
      400,
    );

    const events = [
      event,
      { ...event, status: "ABORTED" },
      { ...event, node_id: "D1" },
      event,
    ];
    const responses = await Promise.all([send(events), send(events)]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    const counts = await Promise.all(
      responses.map(
        async (res) =>
          ((await res.json()) as { ingested_count: number }).ingested_count,
      ),
    );
    expect(counts.sort((a, b) => a - b)).toEqual([0, 3]);

    const otherCount = await DB.prepare(
      "SELECT COUNT(*) AS count FROM door_events WHERE fridge_id = ?",
    )
      .bind(otherId)
      .first<{ count: number }>();
    expect(otherCount?.count).toBe(0);

    // Deleting the fridge revokes its token cleanly via ON DELETE CASCADE.
    await DB.prepare("DELETE FROM fridges WHERE id = ?").bind(fridgeId).run();
    expect((await send([event])).status).toBe(403);
  });

  it("validates JPEG bytes, enforces tenant-scoped R2 keys, and reads/deletes private objects", async () => {
    const { PHOTOS } = getTestEnv();
    const validJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9,
    ]);
    const invalidJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

    expect(isValidJpegBytes(validJpeg)).toBe(true);
    expect(isValidJpegBytes(invalidJpeg)).toBe(false);

    expect(
      inventoryPhotoKey("/storage/food_crops/kitchen/item-abc.jpg", "kitchen"),
    ).toBe("food_crops/kitchen/item-abc.jpg");
    expect(
      inventoryPhotoKey("/storage/food_crops/other/item-abc.jpg", "kitchen"),
    ).toBeNull();
    expect(
      inventoryPhotoKey("food_crops/kitchen/../secret.jpg", "kitchen"),
    ).toBeNull();
    expect(
      inventoryPhotoKey("food_crops/kitchen/bad.png", "kitchen"),
    ).toBeNull();

    const hash = await sha256Hex(validJpeg);
    const key = buildFoodPhotoKey("kitchen", "item-1", hash);
    expect(toStoragePath(key)).toBe(`/storage/${key}`);

    await putImmutablePhoto(PHOTOS, key, validJpeg);
    // Retry with identical immutable key succeeds without error.
    await putImmutablePhoto(PHOTOS, key, validJpeg);

    const obj = await getPrivatePhoto(PHOTOS, key);
    expect(obj).not.toBeNull();
    expect(obj?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(obj?.httpMetadata?.cacheControl).toBe("private, no-store");
    const storedBytes = new Uint8Array(await obj!.arrayBuffer());
    expect(storedBytes).toEqual(validJpeg);

    await deletePrivatePhoto(PHOTOS, key);
    expect(await getPrivatePhoto(PHOTOS, key)).toBeNull();
  });
});
