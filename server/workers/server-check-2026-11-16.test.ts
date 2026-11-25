import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { FridgeRoomEvent } from "./durable-objects/fridge-room";
import { createSignedSessionForEmail } from "./lib/auth";
import { addDaysToIsoDate, bangkokIsoDate } from "./lib/gemini";
import { createFridge } from "./lib/fridges";
import { sha256Hex } from "./lib/gateway";
import {
  LINE_MAX_TEXT_LENGTH,
  capLineText,
  summarizeLineItems,
} from "./lib/line-format";
import {
  enqueuePersonalTest,
  personalDoorAlerts,
  queueMorningDigests,
} from "./lib/personal-notifications";
import { parseDoorEvents } from "./lib/door-events";
import type { AppBindings } from "./types";

interface TestEnv extends AppBindings {
  TEST_MIGRATIONS: D1Migration[];
}

function getTestEnv(): TestEnv {
  return env as unknown as TestEnv;
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

async function setupAuditFixture() {
  const testEnv = getTestEnv();
  const nowS = Math.floor(Date.now() / 1000);
  const ownerEmail = `owner-${crypto.randomUUID()}@example.com`;
  const ownerSession = await createSignedSessionForEmail(
    testEnv,
    "http://localhost/",
    { email: ownerEmail },
  );
  const fridge = await createFridge(
    testEnv.DB,
    ownerEmail,
    "Audit Regression Fridge",
    nowS,
    ownerSession.userId,
  );
  const token = `tok-${crypto.randomUUID()}`;
  await testEnv.DB.prepare(
    "UPDATE fridge_secrets SET gateway_token_hash = ? WHERE fridge_id = ?",
  )
    .bind(await sha256Hex(token), fridge.id)
    .run();
  await testEnv.DB.prepare("UPDATE fridges SET line_target_id = ? WHERE id = ?")
    .bind("C" + "a".repeat(32), fridge.id)
    .run();

  return { testEnv, nowS, fridge, token, ownerEmail, ownerSession };
}

describe("Audit 2026-11-16 regressions", () => {
  beforeAll(async () => {
    await applyD1Migrations(getTestEnv().DB, getTestEnv().TEST_MIGRATIONS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("FW-20261116-01: rejects bypass_cooldown=1 in production and for non-owners, and preserves replay guards", async () => {
    const { testEnv, nowS, fridge, token, ownerSession } =
      await setupAuditFixture();

    const memberEmail = `member-${crypto.randomUUID()}@example.com`;
    const memberSession = await createSignedSessionForEmail(
      testEnv,
      "http://localhost/",
      { email: memberEmail },
    );
    await testEnv.DB.prepare(
      "INSERT INTO fridge_members (fridge_id, email, role, added_at_s) VALUES (?, ?, 'member', ?)",
    )
      .bind(fridge.id, memberEmail, nowS)
      .run();

    const pushes: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      pushes.push(
        JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
      );
      return new Response("{}", { status: 200 });
    });

    const postTelemetry = async (
      query: string,
      ts: number,
      appEnv: "development" | "production",
      cookie?: string,
    ) => {
      const ctx = createExecutionContext();
      try {
        return await worker.fetch(
          new Request(`http://localhost/api/telemetry${query}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              ...(cookie ? { Cookie: cookie } : {}),
            },
            body: JSON.stringify({
              samples: [
                {
                  node_id: "F0",
                  timestamp_s: ts,
                  temp_celsius: 12.0,
                  voc_index: 100,
                  light_ldr: 0,
                },
              ],
            }),
          }),
          { ...testEnv, APP_ENV: appEnv },
          ctx,
        );
      } finally {
        await waitOnExecutionContext(ctx);
      }
    };

    await testEnv.DB.batch(
      [900, 600, 300].map((ago) =>
        testEnv.DB.prepare(
          "INSERT INTO telemetry_samples(fridge_id,node_id,timestamp_s,temp_celsius,voc_index,light_ldr) VALUES (?,'F0',?,12.0,100,0)",
        ).bind(fridge.id, nowS - ago),
      ),
    );
    const initial = await postTelemetry("", nowS, "production");
    expect(initial.status).toBe(200);
    expect(pushes).toHaveLength(1);

    // Production rejects bypass even with owner session cookie
    const prodBypass = await postTelemetry(
      "?bypass_cooldown=1",
      nowS + 10,
      "production",
      ownerSession.cookieHeader.split(";")[0] ?? ownerSession.cookieHeader,
    );
    expect(prodBypass.status).toBe(403);
    expect(pushes).toHaveLength(1);

    // Development rejects invalid parameter
    const invalidParam = await postTelemetry(
      "?bypass_cooldown=2",
      nowS + 15,
      "development",
      ownerSession.cookieHeader.split(";")[0] ?? ownerSession.cookieHeader,
    );
    expect(invalidParam.status).toBe(400);

    // Development rejects unauthenticated & non-owner sessions
    const noSessionBypass = await postTelemetry(
      "?bypass_cooldown=1",
      nowS + 20,
      "development",
    );
    expect(noSessionBypass.status).toBe(403);

    const memberBypass = await postTelemetry(
      "?bypass_cooldown=1",
      nowS + 20,
      "development",
      memberSession.cookieHeader.split(";")[0] ?? memberSession.cookieHeader,
    );
    expect(memberBypass.status).toBe(403);
    expect(pushes).toHaveLength(1);

    // Exact replay (ingested_count=0) with authorized dev+owner bypass must NOT re-send
    const replayBypass = await postTelemetry(
      "?bypass_cooldown=1",
      nowS,
      "development",
      ownerSession.cookieHeader.split(";")[0] ?? ownerSession.cookieHeader,
    );
    expect(replayBypass.status).toBe(200);
    expect(
      ((await replayBypass.json()) as { ingested_count: number })
        .ingested_count,
    ).toBe(0);
    expect(pushes).toHaveLength(1);

    // Seed an unrelated door cooldown to ensure telemetry bypass stays scoped
    await testEnv.DB.prepare(
      "INSERT INTO alert_cooldowns (fridge_id, alert_type, last_sent_s) VALUES (?, 'door_obstruction', ?)",
    )
      .bind(fridge.id, nowS)
      .run();

    // New timestamp with authorized dev+owner bypass succeeds without clearing door cooldown
    const newSampleBypass = await postTelemetry(
      "?bypass_cooldown=1",
      nowS + 30,
      "development",
      ownerSession.cookieHeader.split(";")[0] ?? ownerSession.cookieHeader,
    );
    expect(newSampleBypass.status).toBe(200);
    expect(
      ((await newSampleBypass.json()) as { ingested_count: number })
        .ingested_count,
    ).toBe(1);
    expect(pushes).toHaveLength(2);

    const doorCooldown = await testEnv.DB.prepare(
      "SELECT last_sent_s FROM alert_cooldowns WHERE fridge_id = ? AND alert_type = 'door_obstruction'",
    )
      .bind(fridge.id)
      .first<{ last_sent_s: number }>();
    expect(doorCooldown?.last_sent_s).toBe(nowS);
  });

  it("FW-20261116-02: conflicting duplicate telemetry preserves first-write-wins across D1, snapshot, WS, and LINE alerts", async () => {
    const { testEnv, nowS, fridge, token, ownerSession } =
      await setupAuditFixture();

    const pushes: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      pushes.push(
        JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
      );
      return new Response("{}", { status: 200 });
    });

    const wsRes = await exports.default.fetch(
      `http://localhost/api/fridges/${encodeURIComponent(fridge.id)}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Cookie:
            ownerSession.cookieHeader.split(";")[0] ??
            ownerSession.cookieHeader,
        },
      },
    );
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    const frames: FridgeRoomEvent[] = [];
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        frames.push(JSON.parse(event.data) as FridgeRoomEvent);
      }
    });
    ws.accept();

    try {
      const safe = {
        node_id: "F0",
        timestamp_s: nowS,
        temp_celsius: 3.0,
        voc_index: 95,
        light_ldr: 10,
      };
      const hotConflict = {
        ...safe,
        temp_celsius: 18.0,
        voc_index: 400,
      };

      // Within-batch conflicting duplicate
      const res1 = await exports.default.fetch(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ samples: [safe, hotConflict] }),
        },
      );
      expect(res1.status).toBe(200);
      expect(
        ((await res1.json()) as { ingested_count: number }).ingested_count,
      ).toBe(1);

      // Cross-request conflicting retry
      const res2 = await exports.default.fetch(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ samples: [hotConflict] }),
        },
      );
      expect(res2.status).toBe(200);
      expect(
        ((await res2.json()) as { ingested_count: number }).ingested_count,
      ).toBe(0);

      // Give WS delivery a tick to arrive
      await new Promise((r) => setTimeout(r, 50));

      const dbSample = await testEnv.DB.prepare(
        "SELECT temp_celsius, voc_index FROM telemetry_samples WHERE fridge_id = ?",
      )
        .bind(fridge.id)
        .first<{ temp_celsius: number; voc_index: number }>();
      expect(dbSample).toEqual({ temp_celsius: 3, voc_index: 95 });

      const fridgeRow = await testEnv.DB.prepare(
        "SELECT last_telemetry_json FROM fridges WHERE id = ?",
      )
        .bind(fridge.id)
        .first<{ last_telemetry_json: string }>();
      expect(JSON.parse(fridgeRow!.last_telemetry_json)).toMatchObject({
        temp_celsius: 3,
        voc_index: 95,
      });

      expect(pushes).toHaveLength(0);

      const telemetryFrames = frames.filter((f) => f.type === "telemetry");
      expect(telemetryFrames).toHaveLength(1);
      if (telemetryFrames[0]?.type === "telemetry") {
        expect(telemetryFrames[0].samples).toHaveLength(1);
        expect(telemetryFrames[0].samples[0]?.temp_celsius).toBe(3);
      }
    } finally {
      ws.close(1000, "done");
    }
  });

  it("FW-20261116-03: caps oversized personal door alerts, personal tests, and digests within LINE limits without splitting surrogates", async () => {
    const { testEnv, nowS, fridge, ownerSession } = await setupAuditFixture();

    await testEnv.DB.prepare(
      "INSERT INTO user_line_profiles (user_id, line_user_id, updated_at_s) VALUES (?, ?, ?)",
    )
      .bind(ownerSession.userId, "U" + "b".repeat(32), nowS)
      .run();

    const sentLengths: number[] = [];
    const sentTexts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as {
        messages: Array<{ text: string }>;
      };
      for (const msg of payload.messages) {
        sentLengths.push(msg.text.length);
        sentTexts.push(msg.text);
        if (msg.text.length > LINE_MAX_TEXT_LENGTH) {
          return new Response("{}", { status: 400 });
        }
      }
      return new Response("{}", { status: 200 });
    });

    const events = Array.from({ length: 60 }, (_, i) => ({
      node_id: `D${i}`.padEnd(128, "x"),
      timestamp_s: nowS,
      status: "OBSTRUCTION_ERROR",
    }));
    const parsed = parseDoorEvents({ events }, nowS);
    expect(parsed).not.toBeNull();

    await personalDoorAlerts(testEnv, fridge.id, parsed!, nowS);

    const doorOutbox = await testEnv.DB.prepare(
      "SELECT failed, delivered_s FROM user_line_outbox WHERE user_id = ? AND alert_type = 'obstruct'",
    )
      .bind(ownerSession.userId)
      .first<{ failed: number; delivered_s: number | null }>();
    expect(doorOutbox?.failed).toBe(0);
    expect(doorOutbox?.delivered_s).not.toBeNull();
    expect(sentLengths[0]!).toBeLessThanOrEqual(LINE_MAX_TEXT_LENGTH);
    expect(sentTexts[0]).toContain("พบสิ่งกีดขวางที่ประตู");
    expect(hasLoneSurrogate(sentTexts[0]!)).toBe(false);

    // Also verify enqueuePersonalTest with many long fridge names stays within 5000 code units
    for (let i = 0; i < 90; i++) {
      const extraFridgeId = `long-${i}-${crypto.randomUUID()}`;
      await testEnv.DB.batch([
        testEnv.DB.prepare(
          "INSERT INTO fridges (id, name, created_at_s, ai_budget_owner) VALUES (?, ?, ?, ?)",
        ).bind(
          extraFridgeId,
          `${"F".repeat(70)}-${i}`,
          nowS,
          `other-${i}@example.com`,
        ),
        testEnv.DB.prepare(
          "INSERT INTO fridge_members (fridge_id, email, role, added_at_s) VALUES (?, ?, 'member', ?)",
        ).bind(
          extraFridgeId,
          (await testEnv.DB.prepare("SELECT email FROM user WHERE id = ?")
            .bind(ownerSession.userId)
            .first<{ email: string }>())!.email,
          nowS,
        ),
      ]);
    }
    await enqueuePersonalTest(testEnv, ownerSession.userId, nowS);
    const testOutbox = await testEnv.DB.prepare(
      "SELECT failed, delivered_s FROM user_line_outbox WHERE user_id = ? AND alert_type = 'test'",
    )
      .bind(ownerSession.userId)
      .first<{ failed: number; delivered_s: number | null }>();
    expect(testOutbox?.failed).toBe(0);
    expect(testOutbox?.delivered_s).not.toBeNull();
    expect(sentLengths.every((len) => len <= LINE_MAX_TEXT_LENGTH)).toBe(true);
    expect(sentTexts.every((text) => !hasLoneSurrogate(text))).toBe(true);

    // Surrogate-pair boundary check on digest & helpers
    const emojiEdge = "a".repeat(4999) + "🥬";
    const capped = capLineText(emojiEdge, LINE_MAX_TEXT_LENGTH);
    expect(capped.length).toBeLessThanOrEqual(LINE_MAX_TEXT_LENGTH);
    expect(hasLoneSurrogate(capped)).toBe(false);

    const summarized = summarizeLineItems(
      ["🥬".repeat(50), "🥬".repeat(50)],
      60,
      (n) => ` +${n}`,
    );
    expect(summarized.length).toBeLessThanOrEqual(60);
    expect(hasLoneSurrogate(summarized)).toBe(false);

    // Morning digest safe truncation when many fridges have expiring food
    const localMid = nowS - (nowS % 86400) + 3600; // 08:00 Bangkok (01:00 UTC)
    const today = bangkokIsoDate(localMid);
    const soon = addDaysToIsoDate(today, 1);
    await testEnv.DB.prepare(
      "UPDATE user_line_profiles SET morning_enabled = 1, morning_time = '08:00' WHERE user_id = ?",
    )
      .bind(ownerSession.userId)
      .run();
    const { results: memberFridges } = await testEnv.DB.prepare(
      "SELECT fridge_id FROM fridge_members fm JOIN user u ON lower(trim(u.email)) = fm.email WHERE u.id = ? LIMIT 45",
    )
      .bind(ownerSession.userId)
      .all<{ fridge_id: string }>();
    for (const row of memberFridges) {
      await testEnv.DB.prepare(
        "INSERT INTO inventory (id, fridge_id, name_th, name_en, category, category_th, estimated_expiry_date, storage_recommendation_th, storage_recommendation_en, check_in_timestamp_s, check_in_source) VALUES (?, ?, ?, ?, 'Dairy', 'นม', ?, 'เย็น', 'Cold', ?, 'WEB_MANUAL')",
      )
        .bind(
          crypto.randomUUID(),
          row.fridge_id,
          "🥬".repeat(30),
          "Item",
          soon,
          localMid,
        )
        .run();
    }
    await queueMorningDigests(testEnv, localMid);
    const digestRow = await testEnv.DB.prepare(
      "SELECT messages_json FROM user_line_outbox WHERE user_id = ? AND alert_type = 'morning'",
    )
      .bind(ownerSession.userId)
      .first<{ messages_json: string }>();
    const digestText = (
      JSON.parse(digestRow!.messages_json) as Array<{ text: string }>
    )[0]!.text;
    expect(digestText.length).toBeLessThanOrEqual(LINE_MAX_TEXT_LENGTH);
    expect(hasLoneSurrogate(digestText)).toBe(false);
  });
});
