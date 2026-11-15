import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import worker from "./index";
import { createSignedSessionForEmail } from "./lib/auth";
import { sha256Hex } from "./lib/gateway";
import {
  addDaysToIsoDate,
  bangkokIsoDate,
  classifyCheckInImage,
  GeminiUnavailableError,
} from "./lib/gemini";
import { runDailyCronTasks, tryAcquireAlertCooldown } from "./lib/line";
import type { AppBindings } from "./types";

interface TestEnv extends AppBindings {
  TEST_MIGRATIONS: D1Migration[];
}

function getTestEnv(): TestEnv {
  return env as unknown as TestEnv;
}

const VALID_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9,
]);

function geminiJsonEnvelope(payload: unknown): string {
  return JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  });
}

interface InterceptedRequest {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string;
}

type MockRoute = {
  match: (url: URL, method: string) => boolean;
  handle: (req: InterceptedRequest) => Response;
};

async function seedFridge(
  db: D1Database,
  options: {
    fridgeId: string;
    token: string;
    ownerEmail?: string;
    geminiApiKey?: string | null;
    lineTargetId?: string | null;
  },
): Promise<void> {
  const nowS = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256Hex(options.token);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO fridges (id, name, created_at_s, line_target_id, ai_budget_owner) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(
        options.fridgeId,
        `Fridge ${options.fridgeId}`,
        nowS,
        options.lineTargetId ?? null,
        options.ownerEmail ?? options.fridgeId + "@fixture.example",
      ),
    db
      .prepare(
        `INSERT INTO fridge_secrets (fridge_id, gateway_token, gateway_token_hash, gemini_api_key, updated_at_s)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        options.fridgeId,
        options.token,
        tokenHash,
        options.geminiApiKey ?? null,
        nowS,
      ),
  ];

  if (options.ownerEmail) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO fridge_members (fridge_id, email, role, added_at_s) VALUES (?, ?, 'owner', ?)",
        )
        .bind(options.fridgeId, options.ownerEmail, nowS),
    );
  }

  await db.batch(stmts);
}

function multipartImageRequest(
  url: string,
  token: string,
  bytes: Uint8Array,
  filename = "crop.jpg",
): Request {
  const form = new FormData();
  form.append(
    "image",
    new File([bytes.slice().buffer], filename, { type: "image/jpeg" }),
  );
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

describe("Gemini AI check-in/out, LINE alerts, and daily Cron", () => {
  let mockRoutes: MockRoute[] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    const testEnv = getTestEnv();
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  beforeEach(() => {
    mockRoutes = [];
    originalFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (
        url.hostname === "generativelanguage.googleapis.com" ||
        url.hostname === "api.line.me"
      ) {
        const bodyText = await request.text();
        const routeIdx = mockRoutes.findIndex((r) =>
          r.match(url, request.method.toUpperCase()),
        );
        if (routeIdx === -1) {
          throw new Error(
            `Unexpected unmocked external fetch: ${request.method} ${request.url}`,
          );
        }
        const route = mockRoutes.splice(routeIdx, 1)[0]!;
        return route.handle({
          url: request.url,
          method: request.method.toUpperCase(),
          headers: request.headers,
          bodyText,
        });
      }
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockGemini(
    model: string,
    handler: (req: InterceptedRequest) => Response,
    times = 1,
  ) {
    const expectedPath = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let i = 0; i < times; i += 1) {
      mockRoutes.push({
        match: (url, method) =>
          url.hostname === "generativelanguage.googleapis.com" &&
          url.pathname === expectedPath &&
          method === "POST",
        handle: handler,
      });
    }
  }

  function mockLinePush(
    handler: (req: InterceptedRequest) => Response,
    times = 1,
  ) {
    for (let i = 0; i < times; i += 1) {
      mockRoutes.push({
        match: (url, method) =>
          url.hostname === "api.line.me" &&
          url.pathname === "/v2/bot/message/push" &&
          method === "POST",
        handle: handler,
      });
    }
  }

  it("handles check-in draft validation, unidentifiable 422s, R2 staging, and commit + photo read + WebSocket notification", async () => {
    const testEnv = getTestEnv();
    const { DB, PHOTOS } = testEnv;
    const ownerEmail = `owner-${crypto.randomUUID()}@example.com`;
    const fridgeId = `ci-${crypto.randomUUID()}`;
    const otherFridgeId = `ci-other-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    const noKeyFridgeId = `nokey-${crypto.randomUUID()}`;
    const noKeyToken = `tok-${crypto.randomUUID()}`;

    await seedFridge(DB, {
      fridgeId,
      token,
      ownerEmail,
      geminiApiKey: "test-gemini-key",
    });
    await seedFridge(DB, {
      fridgeId: otherFridgeId,
      token: `tok-${crypto.randomUUID()}`,
    });
    await seedFridge(DB, {
      fridgeId: noKeyFridgeId,
      token: noKeyToken,
      geminiApiKey: null,
    });

    expect(
      (
        await exports.default.fetch(
          "http://localhost/api/inventory/checkin/draft",
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await exports.default.fetch(
          "http://localhost/api/inventory/checkin/draft",
          { method: "POST" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await exports.default.fetch(
          multipartImageRequest(
            "http://localhost/api/inventory/checkin/draft",
            "wrong",
            VALID_JPEG,
          ),
        )
      ).status,
    ).toBe(403);

    const invalidRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkin/draft",
        token,
        new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]),
      ),
    );
    expect(invalidRes.status).toBe(400);

    const oversized = new Uint8Array(5_000_001);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    oversized[oversized.length - 2] = 0xff;
    oversized[oversized.length - 1] = 0xd9;
    const largeRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkin/draft",
        token,
        oversized,
      ),
    );
    expect(largeRes.status).toBe(413);

    const noKeyRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkin/draft",
        noKeyToken,
        VALID_JPEG,
      ),
    );
    expect(noKeyRes.status).toBe(503);

    // Non-food returns 422 UNIDENTIFIABLE with zero R2 or D1 writes.
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            is_food: false,
            name_th: "มือคน",
            name_en: "Human Hand",
            category: "Other",
            estimated_shelf_life_days: 0,
            confidence: 0.95,
            storage_recommendation_th: "",
            storage_recommendation_en: "",
          }),
          { status: 200 },
        ),
    );

    const nonFoodRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkin/draft",
        token,
        VALID_JPEG,
      ),
    );
    expect(nonFoodRes.status).toBe(422);
    expect(((await nonFoodRes.json()) as { error: string }).error).toBe(
      "UNIDENTIFIABLE",
    );

    const listedAfterReject = await PHOTOS.list({
      prefix: `food_crops/${fridgeId}/`,
    });
    expect(listedAfterReject.objects.length).toBe(0);

    // Low confidence (< 0.60) also returns 422.
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            is_food: true,
            name_th: "นมสด",
            name_en: "Milk",
            category: "Dairy",
            estimated_shelf_life_days: 7,
            confidence: 0.59,
            storage_recommendation_th: "เก็บในตู้เย็น",
            storage_recommendation_en: "Refrigerate",
          }),
          { status: 200 },
        ),
    );
    expect(
      (
        await exports.default.fetch(
          multipartImageRequest(
            "http://localhost/api/inventory/checkin/draft",
            token,
            VALID_JPEG,
          ),
        )
      ).status,
    ).toBe(422);

    // Valid recognition uploads crop to R2 and computes deterministic expiry date, zero D1 writes.
    let seenApiKey: string | null = null;
    mockGemini("gemini-3.5-flash-lite", (req) => {
      seenApiKey = req.headers.get("x-goog-api-key");
      return new Response(
        geminiJsonEnvelope({
          is_food: true,
          name_th: "นมสดพาสเจอร์ไรส์",
          name_en: "Pasteurized Whole Milk",
          category: "Dairy",
          estimated_shelf_life_days: 7,
          confidence: 0.94,
          storage_recommendation_th: "เก็บในช่องแช่เย็นหลัก 2-4°C",
          storage_recommendation_en: "Keep sealed on main shelf 2-4°C",
        }),
        { status: 200 },
      );
    });

    const nowS = Math.floor(Date.now() / 1000);
    const expectedExpiry = addDaysToIsoDate(bangkokIsoDate(nowS), 7);
    const draftRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkin/draft",
        token,
        VALID_JPEG,
      ),
    );
    expect(draftRes.status).toBe(200);
    expect(seenApiKey).toBe("test-gemini-key");

    const draftBody = (await draftRes.json()) as {
      name_th: string;
      name_en: string;
      category: string;
      category_th: string;
      estimated_shelf_life_days: number;
      estimated_expiry_date: string;
      storage_recommendation_th: string;
      storage_recommendation_en: string;
      image_storage_path: string;
      confidence: number;
    };

    expect(draftBody.name_en).toBe("Pasteurized Whole Milk");
    expect(draftBody.category_th).toBe("นมและผลิตภัณฑ์นม");
    expect(draftBody.estimated_expiry_date).toBe(expectedExpiry);
    expect(draftBody.image_storage_path).toMatch(
      new RegExp(`^/storage/food_crops/${fridgeId}/crop_[a-f0-9-]+\\.jpg$`),
    );

    const invBeforeCommit = await DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory WHERE fridge_id = ?",
    )
      .bind(fridgeId)
      .first<{ count: number }>();
    expect(invBeforeCommit?.count).toBe(0);

    // Connect WebSocket client as owner to verify live inventory_changed broadcast on commit.
    const { cookieHeader } = await createSignedSessionForEmail(
      testEnv,
      "http://localhost/",
      { email: ownerEmail },
    );
    const cookie = cookieHeader.split(";")[0] ?? cookieHeader;
    const wsRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Cookie: cookie,
        },
      },
    );
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();
    const receivedEvents: Array<{
      type: string;
      action?: string;
      itemId?: string;
    }> = [];
    ws.addEventListener("message", (evt) => {
      receivedEvents.push(JSON.parse(String(evt.data)));
    });

    // Reject committing another fridge's R2 path.
    const badPathRes = await exports.default.fetch(
      "http://localhost/api/inventory/checkin",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...draftBody,
          image_storage_path: `/storage/food_crops/${otherFridgeId}/crop_123.jpg`,
        }),
      },
    );
    expect(badPathRes.status).toBe(400);

    const commitRes = await exports.default.fetch(
      "http://localhost/api/inventory/checkin",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(draftBody),
      },
    );
    expect(commitRes.status).toBe(201);
    const commitBody = (await commitRes.json()) as {
      success: boolean;
      item_id: string;
      message: string;
    };
    expect(commitBody.success).toBe(true);
    expect(commitBody.item_id).toMatch(/^item_[a-f0-9]{16}$/);

    // Owner can read the uploaded crop JPEG via dashboard photo endpoint.
    const photoRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/inventory/${commitBody.item_id}/photo`,
      { headers: { Cookie: cookie } },
    );
    expect(photoRes.status).toBe(200);
    expect(new Uint8Array(await photoRes.arrayBuffer())).toEqual(VALID_JPEG);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(receivedEvents).toContainEqual({
      type: "inventory_changed",
      action: "created",
      itemId: commitBody.item_id,
    });
    ws.close(1000);
  });

  it("handles checkout draft FEFO ordering, hallucinated ID filtering, NO_MATCH, and hard delete commit", async () => {
    const testEnv = getTestEnv();
    const { DB, PHOTOS } = testEnv;
    const fridgeId = `co-${crypto.randomUUID()}`;
    const otherFridgeId = `co-other-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    const emptyFridgeId = `co-empty-${crypto.randomUUID()}`;
    const emptyToken = `tok-${crypto.randomUUID()}`;

    await seedFridge(DB, {
      fridgeId,
      token,
      geminiApiKey: "test-gemini-key",
    });
    await seedFridge(DB, {
      fridgeId: otherFridgeId,
      token: `tok-${crypto.randomUUID()}`,
    });
    await seedFridge(DB, {
      fridgeId: emptyFridgeId,
      token: emptyToken,
      geminiApiKey: "test-gemini-key",
    });

    const cropKey = `food_crops/${fridgeId}/crop_earliest.jpg`;
    await PHOTOS.put(cropKey, VALID_JPEG, {
      httpMetadata: { contentType: "image/jpeg" },
    });

    const nowS = Math.floor(Date.now() / 1000);
    await DB.batch([
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('milk_later', ?, 'นมสด', 'Whole Milk', 'Dairy', 'นมและผลิตภัณฑ์นม', '2026-11-25', ?, NULL, 'CAMERA')`,
      ).bind(fridgeId, nowS),
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('milk_earliest', ?, 'นมสด', 'Whole Milk', 'Dairy', 'นมและผลิตภัณฑ์นม', '2026-11-16', ?, ?, 'CAMERA')`,
      ).bind(fridgeId, nowS - 100, `/storage/${cropKey}`),
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('other_milk', ?, 'นมสด', 'Whole Milk', 'Dairy', 'นมและผลิตภัณฑ์นม', '2026-11-15', ?, NULL, 'CAMERA')`,
      ).bind(otherFridgeId, nowS),
    ]);

    // Gemini returns reversed order plus a hallucinated ID and a cross-fridge ID.
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            match_type: "AMBIGUOUS_MULTIPLE",
            matched_item_id: null,
            candidate_matches: [
              "milk_later",
              "hallucinated_item",
              "other_milk",
              "milk_earliest",
            ],
            identified_name_th: "นมสด",
            identified_name_en: "Whole Milk",
            confidence: 0.91,
            reasoning: "Two milk cartons match the removed bottle.",
          }),
          { status: 200 },
        ),
    );

    const draftRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkout/draft",
        token,
        VALID_JPEG,
      ),
    );
    expect(draftRes.status).toBe(200);
    const draft = (await draftRes.json()) as {
      match_type: string;
      candidate_matches: Array<{
        item_id: string;
        estimated_expiry_date: string;
      }>;
      confidence: number;
    };
    expect(draft.match_type).toBe("AMBIGUOUS_MULTIPLE");
    expect(draft.candidate_matches.map((c) => c.item_id)).toEqual([
      "milk_earliest",
      "milk_later",
    ]);

    // Low confidence checkout draft returns 422.
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            match_type: "NO_MATCH",
            matched_item_id: null,
            candidate_matches: [],
            identified_name_th: "",
            identified_name_en: "",
            confidence: 0.4,
            reasoning: "Blurry frame.",
          }),
          { status: 200 },
        ),
    );
    expect(
      (
        await exports.default.fetch(
          multipartImageRequest(
            "http://localhost/api/inventory/checkout/draft",
            token,
            VALID_JPEG,
          ),
        )
      ).status,
    ).toBe(422);

    // Empty fridge with NO_MATCH returns 200 OK with empty candidates.
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            match_type: "NO_MATCH",
            matched_item_id: null,
            candidate_matches: [],
            identified_name_th: "แอปเปิล",
            identified_name_en: "Apple",
            confidence: 0.88,
            reasoning: "No inventory items available.",
          }),
          { status: 200 },
        ),
    );
    const emptyRes = await exports.default.fetch(
      multipartImageRequest(
        "http://localhost/api/inventory/checkout/draft",
        emptyToken,
        VALID_JPEG,
      ),
    );
    expect(emptyRes.status).toBe(200);
    expect(((await emptyRes.json()) as { match_type: string }).match_type).toBe(
      "NO_MATCH",
    );

    // Commit checkout hard-deletes D1 row AND R2 photo; second attempt returns 404.
    const commitRes = await exports.default.fetch(
      "http://localhost/api/inventory/checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ item_id: "milk_earliest" }),
      },
    );
    expect(commitRes.status).toBe(200);
    expect(await commitRes.json()).toEqual({
      success: true,
      item_id: "milk_earliest",
      status: "deleted",
      message: "Item and associated image permanently removed from inventory.",
    });
    expect(await PHOTOS.get(cropKey)).toBeNull();

    const retryCommit = await exports.default.fetch(
      "http://localhost/api/inventory/checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ item_id: "milk_earliest" }),
      },
    );
    expect(retryCommit.status).toBe(404);
  });

  it("retries Gemini 429/503 responses and falls back to gemini-2.5-flash-lite before throwing 503", async () => {
    const testEnv = getTestEnv();

    mockGemini(
      "gemini-3.5-flash-lite",
      () => new Response("rate limited", { status: 429 }),
    );
    mockGemini(
      "gemini-3.5-flash-lite",
      () => new Response("overloaded", { status: 503 }),
    );
    mockGemini(
      "gemini-3.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            is_food: true,
            name_th: "ไข่ไก่",
            name_en: "Chicken Eggs",
            category: "Other",
            estimated_shelf_life_days: 14,
            confidence: 0.9,
            storage_recommendation_th: "แช่เย็น",
            storage_recommendation_en: "Keep chilled",
          }),
          { status: 200 },
        ),
    );

    const delaysUsed: number[] = [];
    const recovered = await classifyCheckInImage(
      testEnv,
      "k-test",
      VALID_JPEG,
      1792944000,
      {
        retryDelaysMs: [10, 20, 40],
        sleep: async (ms) => {
          delaysUsed.push(ms);
        },
      },
    );
    expect(recovered?.name_en).toBe("Chicken Eggs");
    expect(delaysUsed).toEqual([10, 20]);

    // Exhaust primary retries (4 attempts) -> succeeds on fallback model.
    mockGemini(
      "gemini-3.5-flash-lite",
      () => new Response("down", { status: 503 }),
      4,
    );
    mockGemini(
      "gemini-2.5-flash-lite",
      () =>
        new Response(
          geminiJsonEnvelope({
            is_food: true,
            name_th: "แอปเปิล",
            name_en: "Red Apple",
            category: "Produce",
            estimated_shelf_life_days: 10,
            confidence: 0.87,
            storage_recommendation_th: "แช่ช่องผัก",
            storage_recommendation_en: "Crisper drawer",
          }),
          { status: 200 },
        ),
    );

    const viaFallback = await classifyCheckInImage(
      testEnv,
      "k-test",
      VALID_JPEG,
      1792944000,
      {
        retryDelaysMs: [1, 1, 1],
        sleep: async () => {},
      },
    );
    expect(viaFallback?.name_en).toBe("Red Apple");

    // Exhaust both primary and fallback -> throws GeminiUnavailableError.
    mockGemini(
      "gemini-3.5-flash-lite",
      () => new Response("down", { status: 429 }),
      4,
    );
    mockGemini(
      "gemini-2.5-flash-lite",
      () => new Response("down", { status: 503 }),
      4,
    );

    await expect(
      classifyCheckInImage(testEnv, "k-test", VALID_JPEG, 1792944000, {
        retryDelaysMs: [1, 1, 1],
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(GeminiUnavailableError);
  });

  it("dispatches LINE alerts for door safety errors & VOC/temp spikes with atomic cooldown deduplication", async () => {
    const { DB } = getTestEnv();
    const fridgeId = `line-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    await seedFridge(DB, {
      fridgeId,
      token,
      lineTargetId: "U_line_target_1",
    });

    // Verify atomic cooldown helper across narrow and elapsed windows.
    expect(
      await tryAcquireAlertCooldown(DB, fridgeId, "unit_test", 1000, 300),
    ).toBe(true);
    expect(
      await tryAcquireAlertCooldown(DB, fridgeId, "unit_test", 1299, 300),
    ).toBe(false);
    expect(
      await tryAcquireAlertCooldown(DB, fridgeId, "unit_test", 1300, 300),
    ).toBe(true);

    const pushedPayloads: Array<{
      to: string;
      messages: Array<{ type: string; text: string }>;
    }> = [];

    // Expect 1 push for door obstruction (second obstruction within cooldown is suppressed).
    mockLinePush((req) => {
      pushedPayloads.push(JSON.parse(req.bodyText));
      return new Response("{}", { status: 200 });
    });

    const t0 = Math.floor(Date.now() / 1000);
    const door1 = await exports.default.fetch(
      "http://localhost/api/door_events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          events: [
            { node_id: "D0", timestamp_s: t0, status: "OBSTRUCTION_ERROR" },
          ],
        }),
      },
    );
    expect(door1.status).toBe(200);

    const door2 = await exports.default.fetch(
      "http://localhost/api/door_events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          events: [
            {
              node_id: "D0",
              timestamp_s: t0 + 10,
              status: "OBSTRUCTION_ERROR",
            },
          ],
        }),
      },
    );
    expect(door2.status).toBe(200);
    expect(pushedPayloads.length).toBe(1);
    expect(pushedPayloads[0]?.to).toBe("U_line_target_1");
    expect(pushedPayloads[0]?.messages[0]?.text).toContain("obstruction");

    // Telemetry with high VOC (>= 250) and high temp (> 8.0°C) fires 2 alerts; second sample within cooldown fires 0.
    mockLinePush((req) => {
      pushedPayloads.push(JSON.parse(req.bodyText));
      return new Response("{}", { status: 200 });
    }, 2);

    const tel1 = await exports.default.fetch("http://localhost/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        samples: [
          {
            node_id: "F0",
            timestamp_s: t0,
            temp_celsius: 10.2,
            voc_index: 310,
            light_ldr: 40,
          },
        ],
      }),
    });
    expect(tel1.status).toBe(200);

    const tel2 = await exports.default.fetch("http://localhost/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        samples: [
          {
            node_id: "F0",
            timestamp_s: t0 + 60,
            temp_celsius: 11.0,
            voc_index: 340,
            light_ldr: 40,
          },
        ],
      }),
    });
    expect(tel2.status).toBe(200);
    expect(pushedPayloads.length).toBe(3);
  });

  it("runs scheduled cron expiry digest (FEFO <= 2 days) and cleans up orphaned R2 crops", async () => {
    const testEnv = getTestEnv();
    const { DB, PHOTOS } = testEnv;
    const fridgeId = `cron-${crypto.randomUUID()}`;
    const token = `tok-${crypto.randomUUID()}`;
    await seedFridge(DB, {
      fridgeId,
      token,
      lineTargetId: "G_family_group",
    });

    await DB.prepare("UPDATE fridges SET line_target_id = NULL WHERE id != ?")
      .bind(fridgeId)
      .run();

    const activeKey = `food_crops/${fridgeId}/keep_active.jpg`;
    const orphanKey = `food_crops/${fridgeId}/orphan_stale.jpg`;
    await PHOTOS.put(activeKey, VALID_JPEG);
    await PHOTOS.put(orphanKey, VALID_JPEG);

    // Base timestamp 25h ahead of wall-clock so unreferenced R2 objects exceed 24h age threshold.
    const futureNowS = Math.floor(Date.now() / 1000) + 90_000;
    const today = bangkokIsoDate(futureNowS);
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const plus1 = addDaysToIsoDate(today, 1);
    const plus10 = addDaysToIsoDate(today, 10);

    await DB.batch([
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('exp_past', ?, 'โยเกิร์ต', 'Yogurt', 'Dairy', 'นมและผลิตภัณฑ์นม', ?, ?, ?, 'CAMERA')`,
      ).bind(fridgeId, yesterday, futureNowS - 200, `/storage/${activeKey}`),
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('exp_soon', ?, 'ผักสลัด', 'Salad Greens', 'Produce', 'ผักและผลไม้', ?, ?, NULL, 'CAMERA')`,
      ).bind(fridgeId, plus1, futureNowS - 100),
      DB.prepare(
        `INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, check_in_timestamp_s, image_storage_path, check_in_source)
         VALUES ('exp_later', ?, 'แยมสตรอว์เบอร์รี', 'Strawberry Jam', 'Condiments', 'เครื่องปรุงและซอส', ?, ?, NULL, 'WEB_MANUAL')`,
      ).bind(fridgeId, plus10, futureNowS - 50),
    ]);

    const digests: Array<{
      to: string;
      messages: Array<{ type: string; text: string }>;
    }> = [];
    mockLinePush((req) => {
      digests.push(JSON.parse(req.bodyText));
      return new Response("{}", { status: 200 });
    });

    const summary = await runDailyCronTasks(testEnv, futureNowS);
    expect(summary.deletedCrops).toBeGreaterThanOrEqual(1);
    expect(summary.digestsSent).toBe(1);
    expect(await PHOTOS.get(orphanKey)).toBeNull();
    expect(await PHOTOS.get(activeKey)).not.toBeNull();

    const digestText = digests[0]?.messages[0]?.text ?? "";
    expect(digestText).toContain("โยเกิร์ต");
    expect(digestText).toContain("ผักสลัด");
    expect(digestText).not.toContain("Strawberry Jam");

    // Second cron run within 20h window via Worker scheduled handler respects cooldown.
    const ctx = createExecutionContext();
    worker.scheduled(
      createScheduledController({
        cron: "0 1 * * *",
        scheduledTime: futureNowS * 1000,
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(digests.length).toBe(1);
  });
});
