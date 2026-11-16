import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, test, expect } from "vitest";
import worker from "./index";
import { createSignedSessionForEmail } from "./lib/auth";
import { createFridge, rotateGatewayToken } from "./lib/fridges";
import type { AppBindings } from "./types";
const bindings = env as unknown as AppBindings & {
  TEST_MIGRATIONS: D1Migration[];
};
beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
test("regression: a delayed former-owner settings request cannot obtain the newly rotated gateway token", async () => {
  const email = crypto.randomUUID() + "@example.com";
  const identity = await createSignedSessionForEmail(
    bindings,
    "http://localhost/",
    { email },
  );
  const fridge = await createFridge(
    bindings.DB,
    email,
    "Audit-only fridge",
    Math.floor(Date.now() / 1000),
    identity.userId,
  );
  await bindings.DB.prepare(
    "INSERT INTO fridge_members(fridge_id,email,role,added_at_s) VALUES(?,?,'owner',?)",
  )
    .bind(
      fridge.id,
      "remaining-owner@example.com",
      Math.floor(Date.now() / 1000),
    )
    .run();
  let reading!: () => void;
  const ready = new Promise<void>((resolve) => (reading = resolve));
  let release!: () => void;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reading();
        return new Promise<void>((resolve) => {
          release = () => {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ name: "changed after revocation" }),
              ),
            );
            controller.close();
            resolve();
          };
        });
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(
    "http://localhost/api/fridges/" + fridge.id + "/settings",
    {
      method: "PUT",
      headers: {
        Cookie: identity.cookieHeader.split(";")[0]!,
        "Content-Type": "application/json",
      },
      body,
    },
  );
  const responsePromise = worker.fetch(
    request,
    bindings,
    createExecutionContext(),
  );
  await ready;
  await bindings.DB.prepare(
    "DELETE FROM fridge_members WHERE fridge_id=? AND email=?",
  )
    .bind(fridge.id, email)
    .run();
  const replacement = await rotateGatewayToken(
    bindings.DB,
    fridge.id,
    Math.floor(Date.now() / 1000),
    "remaining-owner@example.com",
  );
  release();
  const response = await responsePromise;
  const result = (await response.json()) as {
    gateway_token?: string;
    name?: string;
  };
  expect(replacement).toBeTruthy();
  expect(response.status).toBe(403);
  expect(result.gateway_token).toBeUndefined();
  const persisted = await bindings.DB.prepare(
    "SELECT name FROM fridges WHERE id=?",
  )
    .bind(fridge.id)
    .first<{ name: string }>();
  expect(persisted!.name).toBe("Audit-only fridge");
});
import { afterEach, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
async function setupAuditFridge() {
  const email = crypto.randomUUID() + "@example.com";
  const who = await createSignedSessionForEmail(bindings, "http://localhost/", {
    email,
  });
  const fridge = await createFridge(
    bindings.DB,
    email,
    "Audit fridge",
    Math.floor(Date.now() / 1000),
    who.userId,
  );
  return {
    fridge,
    cookie: who.cookieHeader.split(";")[0]!,
    userId: who.userId,
  };
}
async function apiForAudit(
  id: string,
  cookie: string,
  suffix: string,
  method: string,
  body?: unknown,
) {
  return worker.fetch(
    new Request("http://localhost/api/fridges/" + id + suffix, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    bindings,
    createExecutionContext(),
  );
}
test("regression: general settings reject every raw recipient representation", async () => {
  const { fridge, cookie } = await setupAuditFridge();
  for (const [suffix, method] of [
    ["/settings", "PUT"],
    ["", "PATCH"],
  ]) {
    for (const target of ["C" + "7".repeat(32), null, ""]) {
      const response = await apiForAudit(fridge.id, cookie, suffix!, method!, {
        name: "Rejected",
        line_target_id: target,
      });
      expect(response.status).toBe(400);
    }
  }
  expect(
    (await bindings.DB.prepare("SELECT line_target_id FROM fridges WHERE id=?")
      .bind(fridge.id)
      .first<{ line_target_id: string | null }>())!.line_target_id,
  ).toBeNull();
});

test("regression: retrying the same manual request does not recreate an item after checkout", async () => {
  const { fridge, cookie } = await setupAuditFridge();
  const item = {
    item_id: crypto.randomUUID(),
    name: "Audit milk",
    estimated_expiry_date: "2027-01-01",
    category: "Dairy",
  };
  expect(
    (await apiForAudit(fridge.id, cookie, "/inventory", "POST", item)).status,
  ).toBe(201);
  expect(
    (await apiForAudit(fridge.id, cookie, "/inventory", "POST", item)).status,
  ).toBe(200);
  expect(
    (
      await apiForAudit(
        fridge.id,
        cookie,
        "/inventory/" + item.item_id,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(
    await bindings.DB.prepare("SELECT 1 FROM inventory WHERE id=?")
      .bind(item.item_id)
      .first(),
  ).toBeNull();
  expect(
    (await apiForAudit(fridge.id, cookie, "/inventory", "POST", item)).status,
  ).toBe(200);
  expect(
    await bindings.DB.prepare("SELECT 1 FROM inventory WHERE id=?")
      .bind(item.item_id)
      .first(),
  ).toBeNull();
});
import { commitCameraCheckIn, parseCheckInCommit } from "./lib/ai-inventory";
import { ingestTelemetry, parseTelemetry } from "./lib/telemetry";
import { ingestDoorEvents, parseDoorEvents } from "./lib/door-events";
import { queueMorningDigests } from "./lib/personal-notifications";
import { classifyCheckInImage } from "./lib/gemini";
test("regression: duplicate camera check-in commits create one inventory row", async () => {
  const { fridge } = await setupAuditFridge();
  const payload = parseCheckInCommit(
    {
      name_th: "นมทดสอบ",
      name_en: "Audit milk",
      category: "Dairy",
      category_th: "นม",
      estimated_shelf_life_days: 2,
      estimated_expiry_date: "2027-01-01",
      storage_recommendation_th: "เย็น",
      storage_recommendation_en: "Chill",
      image_storage_path: "/storage/food_crops/" + fridge.id + "/audit.jpg",
      confidence: 1,
    },
    fridge.id,
  )!;
  expect(payload).not.toBeNull();
  const now = Math.floor(Date.now() / 1000);
  const key = crypto.randomUUID();
  const first = await commitCameraCheckIn(
    bindings.DB,
    fridge.id,
    payload,
    now,
    key,
  );
  const second = await commitCameraCheckIn(
    bindings.DB,
    fridge.id,
    payload,
    now,
    key,
  );
  expect(first).toBe(second);
  const count = await bindings.DB.prepare(
    "SELECT COUNT(*) AS n FROM inventory WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ n: number }>();
  expect(count!.n).toBe(1);
});
test("regression: a future sensor sample cannot pin latest telemetry over a later valid report", async () => {
  const { fridge } = await setupAuditFridge();
  const now = Math.floor(Date.now() / 1000);
  const future = now + 10 * 365 * 86400;
  const raw = {
    node_id: "F0",
    timestamp_s: future,
    temp_celsius: 2,
    voc_index: 100,
    light_ldr: 10,
  };
  const parsed = parseTelemetry({ samples: [raw] }, now);
  expect(parsed).toBeNull();
  await expect(
    ingestTelemetry(bindings.DB, fridge.id, [raw], now),
  ).rejects.toThrow("INVALID_EVENT_TIME");
  await bindings.DB.prepare(
    "UPDATE fridges SET last_telemetry_json=? WHERE id=?",
  )
    .bind(JSON.stringify(raw), fridge.id)
    .run();
  await ingestTelemetry(
    bindings.DB,
    fridge.id,
    [{ ...raw, timestamp_s: now, temp_celsius: 7 }],
    now + 1,
  );
  const row = await bindings.DB.prepare(
    "SELECT last_telemetry_json FROM fridges WHERE id=?",
  )
    .bind(fridge.id)
    .first<{ last_telemetry_json: string }>();
  expect(JSON.parse(row!.last_telemetry_json).timestamp_s).toBe(now);
  expect(JSON.parse(row!.last_telemetry_json).temp_celsius).toBe(7);
});
test("regression: a future door success is excluded from morning summaries on consecutive days", async () => {
  const { fridge, userId } = await setupAuditFridge();
  const now = Math.floor(Date.UTC(2026, 11, 2, 0, 30) / 1000);
  const future = now + 10 * 365 * 86400;
  await expect(
    ingestDoorEvents(
      bindings.DB,
      fridge.id,
      [{ node_id: "D0", timestamp_s: future, status: "SUCCESS" }],
      now,
    ),
  ).rejects.toThrow("INVALID_EVENT_TIME");
  const events = parseDoorEvents(
    { events: [{ node_id: "D0", timestamp_s: future, status: "SUCCESS" }] },
    now,
  );
  expect(events).toBeNull();
  await bindings.DB.prepare(
    "INSERT INTO door_events(fridge_id,node_id,timestamp_s,status) VALUES(?,'D0',?,'SUCCESS')",
  )
    .bind(fridge.id, future)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO user_line_profiles(user_id,line_user_id,updated_at_s) VALUES(?,?,?)",
  )
    .bind(userId, "U" + "8".repeat(32), now)
    .run();
  for (const at of [now - 10, now + 86400 - 10])
    await bindings.DB.prepare(
      "INSERT INTO door_events(fridge_id,node_id,timestamp_s,status) VALUES(?,'D0',?,'SUCCESS')",
    )
      .bind(fridge.id, at)
      .run();
  await queueMorningDigests(bindings, now);
  await queueMorningDigests(bindings, now + 86400);
  const jobs = await bindings.DB.prepare(
    "SELECT messages_json FROM user_line_outbox WHERE user_id=? AND alert_type='morning'",
  )
    .bind(userId)
    .all<{ messages_json: string }>();
  expect(jobs.results).toHaveLength(2);
  expect(
    jobs.results.every((job) => job.messages_json.includes("ประตูปิดเอง 1 ครั้ง")),
  ).toBe(true);
});
test("regression: malformed successful Gemini responses cause only one upstream attempt", async () => {
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"is_food":' }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  await expect(
    classifyCheckInImage(
      bindings,
      "audit-only-not-a-real-key",
      new Uint8Array([255, 216, 255, 217]),
      Math.floor(Date.now() / 1000),
      { retryDelaysMs: [0, 0, 0], sleep: async () => {} },
    ),
  ).rejects.toThrow();
  expect(mock).toHaveBeenCalledTimes(1);
});
test("regression: create-fridge rejects megabytes of unused JSON padding", async () => {
  const email = crypto.randomUUID() + "@example.com";
  const identity = await createSignedSessionForEmail(
    bindings,
    "http://localhost/",
    { email },
  );
  const payload = JSON.stringify({
    name: "Large-body audit",
    padding: "x".repeat(3 * 1024 * 1024),
  });
  const response = await worker.fetch(
    new Request("http://localhost/api/fridges", {
      method: "POST",
      headers: {
        Cookie: identity.cookieHeader.split(";")[0]!,
        "Content-Type": "application/json",
      },
      body: payload,
    }),
    bindings,
    createExecutionContext(),
  );
  expect(response.status).toBe(413);
});
async function signedAuditWebhook(events: unknown[]) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(bindings.LINE_CHANNEL_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return worker.fetch(
    new Request("http://localhost/api/line/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": btoa(String.fromCharCode(...sig)),
      },
      body,
    }),
    bindings,
    createExecutionContext(),
  );
}
test("regression: signed unfollow receipts do not exhaust the global allowance or block another users valid pair", async () => {
  const email = crypto.randomUUID() + "@example.com";
  const identity = await createSignedSessionForEmail(
    bindings,
    "http://localhost/",
    { email },
  );
  const cookie = identity.cookieHeader.split(";")[0]!;
  const issued = await worker.fetch(
    new Request("http://localhost/api/me/line/pair", {
      method: "POST",
      headers: { Cookie: cookie },
    }),
    bindings,
    createExecutionContext(),
  );
  expect(issued.status).toBe(201);
  const code = ((await issued.json()) as { code: string }).code;
  for (let i = 0; i < 200; i++) {
    const response = await signedAuditWebhook([
      {
        type: "unfollow",
        webhookEventId: crypto.randomUUID(),
        timestamp: Date.now(),
        source: { type: "user", userId: "U" + "9".repeat(32) },
      },
    ]);
    expect(response.status).toBe(200);
  }
  const response = await signedAuditWebhook([
    {
      type: "message",
      webhookEventId: crypto.randomUUID(),
      timestamp: Date.now(),
      source: { type: "user", userId: "U" + "5".repeat(32) },
      message: { type: "text", id: crypto.randomUUID(), text: code },
    },
  ]);
  expect(response.status).toBe(200);
  const profile = await bindings.DB.prepare(
    "SELECT line_user_id FROM user_line_profiles WHERE user_id=?",
  )
    .bind(identity.userId)
    .first<{ line_user_id: string | null }>();
  expect(profile?.line_user_id).toBe("U" + "5".repeat(32));
}, 30000);
test("regression: identical draft retries reuse upstream results and staged photos", async () => {
  const { fridge } = await setupAuditFridge();
  await bindings.DB.prepare(
    "UPDATE fridge_secrets SET gemini_api_key=? WHERE fridge_id=?",
  )
    .bind("audit-only-not-a-real-key", fridge.id)
    .run();
  const token = await rotateGatewayToken(
    bindings.DB,
    fridge.id,
    Math.floor(Date.now() / 1000),
    (await bindings.DB.prepare(
      "SELECT email FROM fridge_members WHERE fridge_id=?",
    )
      .bind(fridge.id)
      .first<{ email: string }>())!.email,
  );
  const generated = {
    is_food: true,
    name_th: "นม",
    name_en: "Milk",
    category: "Dairy",
    estimated_shelf_life_days: 2,
    confidence: 0.99,
    storage_recommendation_th: "เย็น",
    storage_recommendation_en: "Chill",
  };
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(generated) }] } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  const operationId = crypto.randomUUID();
  async function draft() {
    const form = new FormData();
    form.set(
      "image",
      new Blob([new Uint8Array([255, 216, 255, 0, 255, 217])], {
        type: "image/jpeg",
      }),
      "audit.jpg",
    );
    return worker.fetch(
      new Request("http://localhost/api/inventory/checkin/draft", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Idempotency-Key": operationId,
        },
        body: form,
      }),
      bindings,
      createExecutionContext(),
    );
  }
  const first = await draft(),
    second = await draft();
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const a = (await first.json()) as { image_storage_path: string };
  const b = (await second.json()) as { image_storage_path: string };
  expect(a.image_storage_path).toBe(b.image_storage_path);
  expect(mock).toHaveBeenCalledTimes(1);
  const reservations = await bindings.DB.prepare(
    "SELECT COUNT(*) AS n FROM ai_reservations WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ n: number }>();
  expect(reservations!.n).toBe(1);
});
import {
  getFridgeSettings,
  updateFridgeSettings,
  deleteFridge,
} from "./lib/fridges";
import { runDraftOperation } from "./lib/operations";
import {
  deleteInventoryItem,
  listDoorEvents,
  queryTelemetryHistory,
} from "./lib/inventory";

test("revoked owner cannot read secrets, mutate settings, rotate credentials or delete photos through shared helpers", async () => {
  const { fridge, cookie } = await setupAuditFridge();
  const email = (await bindings.DB.prepare(
    "SELECT email FROM fridge_members WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ email: string }>())!.email;
  const key = `food_crops/${fridge.id}/keep.jpg`;
  await bindings.PHOTOS.put(key, new Uint8Array([1]));
  await bindings.DB.prepare(
    "UPDATE fridge_members SET role='member' WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .run();
  expect(await getFridgeSettings(bindings.DB, fridge.id, email)).toBeNull();
  expect(
    await updateFridgeSettings(
      bindings.DB,
      fridge.id,
      { name: "forbidden", gemini_api_key: "fake-test-only" },
      1,
      email,
    ),
  ).toBe(false);
  expect(await rotateGatewayToken(bindings.DB, fridge.id, 1, email)).toBeNull();
  expect(
    await deleteFridge(bindings.DB, bindings.PHOTOS, fridge.id, email),
  ).toBe(false);
  expect(await bindings.PHOTOS.head(key)).not.toBeNull();
  expect(
    (await apiForAudit(fridge.id, cookie, "/settings", "GET")).status,
  ).toBe(403);
});

test("JSON stream overflow is cancelled even with a false Content-Length", async () => {
  const { cookie } = await setupAuditFridge();
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(40 * 1024).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await worker.fetch(
    new Request("http://localhost/api/fridges", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Content-Length": "1",
      },
      body,
    }),
    bindings,
    createExecutionContext(),
  );
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(pulls).toBe(2);
});

test("maximum manual JPEG still fits the endpoint JSON budget", async () => {
  const { fridge, cookie } = await setupAuditFridge();
  const bytes = new Uint8Array(1_500_000);
  bytes.set([255, 216, 255]);
  bytes.set([255, 217], bytes.length - 2);
  const response = await apiForAudit(fridge.id, cookie, "/inventory", "POST", {
    item_id: crypto.randomUUID(),
    name: "Full photo",
    estimated_expiry_date: "2027-01-01",
    category: "Dairy",
    jpeg_base64: Buffer.from(bytes).toString("base64"),
  });
  expect(response.status).toBe(201);
  const stored = await bindings.DB.prepare(
    "SELECT image_storage_path FROM inventory WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ image_storage_path: string }>();
  expect(
    (
      await bindings.PHOTOS.head(
        stored!.image_storage_path.replace("/storage/", ""),
      )
    )?.size,
  ).toBe(1_500_000);
});

test("telemetry budget preserves maximum batches and old store-and-forward samples", async () => {
  const { fridge } = await setupAuditFridge();
  const email = (await bindings.DB.prepare(
    "SELECT email FROM fridge_members WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ email: string }>())!.email;
  const token = await rotateGatewayToken(bindings.DB, fridge.id, 1, email);
  const now = Math.floor(Date.now() / 1000);
  const samples = Array.from({ length: 10_000 }, (_, i) => ({
    node_id: "F".repeat(128),
    timestamp_s: now - i,
    temp_celsius: 3,
    voc_index: 0,
    light_ldr: 0,
  }));
  const response = await worker.fetch(
    new Request("http://localhost/api/telemetry", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ samples }),
    }),
    bindings,
    createExecutionContext(),
  );
  expect(response.status).toBe(200);
  expect(
    ((await response.json()) as { ingested_count: number }).ingested_count,
  ).toBe(10_000);
  expect(
    parseTelemetry({ samples: [{ ...samples[0], timestamp_s: 0 }] }, now),
  ).not.toBeNull();
  expect(
    parseTelemetry(
      { samples: [{ ...samples[0], timestamp_s: now + 300 }] },
      now,
    ),
  ).not.toBeNull();
  expect(
    parseTelemetry(
      { samples: [{ ...samples[0], timestamp_s: now + 301 }] },
      now,
    ),
  ).toBeNull();
}, 30000);

test("future legacy rows are excluded from current telemetry and door history", async () => {
  const { fridge } = await setupAuditFridge();
  const now = Math.floor(Date.now() / 1000);
  await bindings.DB.prepare(
    "INSERT INTO door_events(fridge_id,node_id,timestamp_s,status) VALUES(?,'D0',?,'SUCCESS')",
  )
    .bind(fridge.id, now + 99999)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO telemetry_samples(fridge_id,node_id,timestamp_s,temp_celsius,voc_index,light_ldr) VALUES(?,'F0',?,3,0,0)",
  )
    .bind(fridge.id, now + 99999)
    .run();
  expect(await listDoorEvents(bindings.DB, fridge.id, undefined, now)).toEqual(
    [],
  );
  expect(
    await queryTelemetryHistory(bindings.DB, fridge.id, "1h", now),
  ).toEqual([]);
});

test("camera receipts are atomic, survive checkout, reject changed input and permit distinct real items", async () => {
  const { fridge } = await setupAuditFridge();
  const now = Math.floor(Date.now() / 1000),
    key = crypto.randomUUID();
  const payload = parseCheckInCommit(
    {
      name_th: "นม",
      name_en: "Milk",
      category: "Dairy",
      category_th: "นม",
      estimated_shelf_life_days: 2,
      estimated_expiry_date: "2027-01-01",
      storage_recommendation_th: "เย็น",
      storage_recommendation_en: "Chill",
      image_storage_path: `/storage/food_crops/${fridge.id}/same.jpg`,
      confidence: 1,
    },
    fridge.id,
  )!;
  const [a, b] = await Promise.all([
    commitCameraCheckIn(bindings.DB, fridge.id, payload, now, key),
    commitCameraCheckIn(bindings.DB, fridge.id, payload, now, key),
  ]);
  expect(a).toBe(b);
  await expect(
    commitCameraCheckIn(
      bindings.DB,
      fridge.id,
      { ...payload, name_en: "Changed" },
      now,
      key,
    ),
  ).rejects.toThrow("different input");
  const separate = await commitCameraCheckIn(
    bindings.DB,
    fridge.id,
    payload,
    now,
    crypto.randomUUID(),
  );
  expect(separate).not.toBe(a);
  await deleteInventoryItem(bindings.DB, bindings.PHOTOS, fridge.id, a);
  expect(
    await commitCameraCheckIn(bindings.DB, fridge.id, payload, now, key),
  ).toBe(a);
  expect(
    await bindings.DB.prepare("SELECT 1 FROM inventory WHERE id=?")
      .bind(a)
      .first(),
  ).toBeNull();
  expect(
    await bindings.DB.prepare("SELECT 1 FROM inventory WHERE id=?")
      .bind(separate)
      .first(),
  ).not.toBeNull();
});

test("draft receipts serialize concurrent calls and preserve uncertain results without replay", async () => {
  const { fridge } = await setupAuditFridge();
  const key = crypto.randomUUID();
  let calls = 0;
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve)),
    wait = new Promise<void>((resolve) => (release = resolve));
  const run = async () => {
    calls++;
    ready();
    await wait;
    return Response.json({ answer: "saved" });
  };
  const first = runDraftOperation(
    bindings.DB,
    fridge.id,
    "checkout",
    key,
    "hash",
    run,
  );
  await started;
  expect(
    (
      await runDraftOperation(
        bindings.DB,
        fridge.id,
        "checkout",
        key,
        "hash",
        run,
      )
    ).status,
  ).toBe(409);
  release();
  expect(await (await first).json()).toEqual({ answer: "saved" });
  expect(
    await (
      await runDraftOperation(
        bindings.DB,
        fridge.id,
        "checkout",
        key,
        "hash",
        run,
      )
    ).json(),
  ).toEqual({ answer: "saved" });
  expect(calls).toBe(1);
  await expect(
    runDraftOperation(bindings.DB, fridge.id, "checkout", key, "changed", run),
  ).rejects.toThrow("different input");
  const uncertain = crypto.randomUUID();
  let attempts = 0;
  const fail = async () => {
    attempts++;
    throw Error("ambiguous upstream failure");
  };
  await expect(
    runDraftOperation(
      bindings.DB,
      fridge.id,
      "checkin",
      uncertain,
      "hash",
      fail,
    ),
  ).rejects.toThrow();
  expect(
    (
      await runDraftOperation(
        bindings.DB,
        fridge.id,
        "checkin",
        uncertain,
        "hash",
        fail,
      )
    ).status,
  ).toBe(409);
  expect(attempts).toBe(1);
});

test("quota denial releases a draft claim safely before any generation", async () => {
  const { fridge } = await setupAuditFridge();
  const key = crypto.randomUUID();
  expect(
    (
      await runDraftOperation(
        bindings.DB,
        fridge.id,
        "checkin",
        key,
        "hash",
        async () => Response.json({ error: "RATE_LIMITED" }, { status: 429 }),
      )
    ).status,
  ).toBe(429);
  expect(
    (
      await runDraftOperation(
        bindings.DB,
        fridge.id,
        "checkin",
        key,
        "hash",
        async () => Response.json({ ok: true }),
      )
    ).status,
  ).toBe(200);
});

test("missing and malformed Idempotency-Key are rejected before camera operations", async () => {
  const { fridge } = await setupAuditFridge();
  const email = (await bindings.DB.prepare(
    "SELECT email FROM fridge_members WHERE fridge_id=?",
  )
    .bind(fridge.id)
    .first<{ email: string }>())!.email;
  const token = await rotateGatewayToken(bindings.DB, fridge.id, 1, email);
  for (const endpoint of ["checkin", "checkin/draft", "checkout/draft"])
    for (const key of ["", "not-a-uuid"]) {
      const response = await worker.fetch(
        new Request("http://localhost/api/inventory/" + endpoint, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            ...(key ? { "Idempotency-Key": key } : {}),
          },
        }),
        bindings,
        createExecutionContext(),
      );
      expect(response.status).toBe(400);
    }
});

test("successful malformed outer JSON and ambiguous network errors never regenerate", async () => {
  for (const scenario of ["invalid-json", "network-error"]) {
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (scenario === "network-error") throw Error("connection lost");
      return new Response("{", { status: 200 });
    });
    await expect(
      classifyCheckInImage(
        bindings,
        "fake-test-key",
        new Uint8Array([255, 216, 255, 217]),
        1,
        { retryDelaysMs: [0, 0, 0], sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockRestore();
  }
});
