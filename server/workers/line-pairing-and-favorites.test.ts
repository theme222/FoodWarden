import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { createSignedSessionForEmail } from "./lib/auth";
import {
  dispatchPersonalOutbox,
  queueMorningDigests,
  personalTelemetryAlerts,
} from "./lib/personal-notifications";
import type { AppBindings } from "./types";
const bindings = env as unknown as AppBindings & {
  TEST_MIGRATIONS: D1Migration[];
};
const secret = "test-line-webhook-channel-secret";
const lineUser = "U" + "a".repeat(32);
const group = "C" + "b".repeat(32);
async function identity() {
  const email = crypto.randomUUID() + "@example.com";
  const result = await createSignedSessionForEmail(
    bindings,
    "http://localhost/",
    { email },
  );
  return { ...result, email, cookie: result.cookieHeader.split(";")[0]! };
}
async function api(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown,
) {
  return exports.default.fetch("http://localhost/api" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function fridge(cookie: string) {
  const r = await api("/fridges", cookie, "POST", { name: "Family kitchen" });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
async function pair(cookie: string, path = "/me/line/pair") {
  const r = await api(path, cookie, "POST");
  expect(r.status).toBe(201);
  return (await r.json()) as { code: string; expires_at_s: number };
}
async function webhook(
  code: string,
  source: { type: string; userId?: string; groupId?: string },
  eventId = crypto.randomUUID(),
  channelSecret = secret,
  timestamp = Date.now(),
) {
  const body = JSON.stringify({
    events: [
      {
        type: "message",
        webhookEventId: eventId,
        replyToken: "test-reply",
        timestamp,
        source,
        message: { id: eventId, type: "text", text: code },
      },
    ],
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return exports.default.fetch("http://localhost/api/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": btoa(String.fromCharCode(...sig)),
    },
    body,
  });
}
describe("LINE pairing, personal preferences and favorite isolation", () => {
  beforeAll(async () => {
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("requires authentication, accepts verification payloads only with a valid raw-body signature", async () => {
    expect(
      (await exports.default.fetch("http://localhost/api/me/line")).status,
    ).toBe(401);
    const r = await exports.default.fetch("http://localhost/api/line/webhook", {
      method: "POST",
      body: '{"events":[]}',
    });
    expect(r.status).toBe(403);
    const code = "FW-ABCD-EFGH";
    expect(
      (
        await webhook(
          code,
          { type: "user", userId: lineUser },
          crypto.randomUUID(),
          "wrong-secret",
        )
      ).status,
    ).toBe(403);
  });
  it("pairs personal LINE once, hashes codes, rejects group redemption and preserves per-account preferences", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const alice = await identity();
    const bob = await identity();
    const code = await pair(alice.cookie);
    const rows = await bindings.DB.prepare(
      "SELECT code_hash FROM line_pairing_codes WHERE user_id=?",
    )
      .bind(alice.userId)
      .all<{ code_hash: string }>();
    expect(rows.results[0]!.code_hash).not.toBe(code.code);
    expect(rows.results[0]!.code_hash).toMatch(/^[a-f0-9]{64}$/);
    await webhook(code.code, {
      type: "group",
      userId: lineUser,
      groupId: group,
    });
    expect(
      (
        (await (await api("/me/line", alice.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
    const eventId = crypto.randomUUID();
    expect(
      (await webhook(code.code, { type: "user", userId: lineUser }, eventId))
        .status,
    ).toBe(200);
    await webhook(code.code, { type: "user", userId: lineUser }, eventId);
    expect(
      (
        (await (await api("/me/line", alice.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(true);
    expect(
      (
        (await (await api("/me/line", bob.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
    expect(
      (
        await api("/me/line", alice.cookie, "PATCH", {
          morning_time: "08:15",
          inst_warm: false,
        })
      ).status,
    ).toBe(200);
    const profile = (await (await api("/me/line", alice.cookie)).json()) as {
      morning_time: string;
      inst_warm: boolean;
    };
    expect(profile.morning_time).toBe("08:15");
    expect(profile.inst_warm).toBe(false);
    expect(
      (await api("/me/line", bob.cookie, "PATCH", { user_id: alice.userId }))
        .status,
    ).toBe(400);
    expect(
      (await api("/me/line", bob.cookie, "PATCH", { morning_time: "25:90" }))
        .status,
    ).toBe(400);
    expect((await api("/me/line", alice.cookie, "DELETE")).status).toBe(200);
    await webhook(code.code, { type: "user", userId: lineUser });
    expect(
      (
        (await (await api("/me/line", alice.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
  });
  it("rechecks owner permissions when the group code is redeemed and protects against code expiry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const owner = await identity();
    const member = await identity();
    const id = await fridge(owner.cookie);
    await api(`/fridges/${id}/members`, owner.cookie, "POST", {
      email: member.email,
      role: "member",
    });
    expect(
      (await api(`/fridges/${id}/line/pair`, member.cookie, "POST")).status,
    ).toBe(403);
    const code = await pair(owner.cookie, `/fridges/${id}/line/pair`);
    await bindings.DB.prepare(
      "UPDATE fridge_members SET role='member' WHERE fridge_id=? AND email=?",
    )
      .bind(id, owner.email)
      .run();
    await webhook(code.code, {
      type: "group",
      groupId: group,
      userId: lineUser,
    });
    expect(
      (
        (await (await api(`/fridges/${id}/line`, member.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
    await bindings.DB.prepare(
      "UPDATE fridge_members SET role='owner' WHERE fridge_id=? AND email=?",
    )
      .bind(id, owner.email)
      .run();
    const expired = await pair(owner.cookie, `/fridges/${id}/line/pair`);
    await bindings.DB.prepare(
      "UPDATE line_pairing_codes SET expires_at_s=0 WHERE user_id=?",
    )
      .bind(owner.userId)
      .run();
    await webhook(expired.code, {
      type: "group",
      groupId: group,
      userId: lineUser,
    });
    expect(
      (
        (await (await api(`/fridges/${id}/line`, owner.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
  });

  it("pairs an owner-selected family group and does not reconnect with consumed codes after disconnect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const account = await identity();
    const id = await fridge(account.cookie);
    const code = await pair(account.cookie, `/fridges/${id}/line/pair`);
    const source = {
      type: "group",
      groupId: "C" + "f".repeat(32),
      userId: "U" + "f".repeat(32),
    };
    await webhook(code.code, source);
    let state = (await (
      await api(`/fridges/${id}/line`, account.cookie)
    ).json()) as { linked: boolean; kind: string };
    expect(state.linked).toBe(true);
    expect(state.kind).toBe("group");
    expect(
      (
        await api(`/fridges/${id}/settings`, account.cookie, "PUT", {
          name: "Renamed fridge",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        (await (await api(`/fridges/${id}/line`, account.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(true);
    expect(
      (await api(`/fridges/${id}/line`, account.cookie, "DELETE")).status,
    ).toBe(200);
    await webhook(code.code, source);
    state = (await (
      await api(`/fridges/${id}/line`, account.cookie)
    ).json()) as { linked: boolean; kind: string };
    expect(state.linked).toBe(false);
  });
  it("keeps favorites private, preserves out-of-stock entries and rejects cross-fridge selection", async () => {
    const owner = await identity();
    const member = await identity();
    const id = await fridge(owner.cookie);
    const other = await fridge(owner.cookie);
    await api(`/fridges/${id}/members`, owner.cookie, "POST", {
      email: member.email,
      role: "member",
    });
    await bindings.DB.prepare(
      `INSERT INTO inventory(id,fridge_id,name_th,name_en,category,category_th,estimated_expiry_date,check_in_timestamp_s,check_in_source) VALUES('milk',?,'นม','Milk','Dairy','นม','2027-01-01',?,'CAMERA')`,
    )
      .bind(id, Math.floor(Date.now() / 1000))
      .run();
    expect(
      (await api(`/fridges/${id}/favorites/milk`, member.cookie, "PUT")).status,
    ).toBe(200);
    expect(
      (await api(`/fridges/${other}/favorites/milk`, member.cookie, "PUT"))
        .status,
    ).toBe(403);
    const mine = (await (
      await api(`/fridges/${id}/favorites`, member.cookie)
    ).json()) as { items: { count: number }[] };
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]!.count).toBe(1);
    expect(
      (
        (await (
          await api(`/fridges/${id}/favorites`, owner.cookie)
        ).json()) as { items: unknown[] }
      ).items,
    ).toHaveLength(0);
    await bindings.DB.prepare("DELETE FROM inventory WHERE id='milk'").run();
    expect(
      (
        (await (
          await api(`/fridges/${id}/favorites`, member.cookie)
        ).json()) as { items: { count: number }[] }
      ).items[0]!.count,
    ).toBe(0);
    expect(
      (
        await api(`/fridges/${id}/favorites/categories`, member.cookie, "PUT", {
          categories: ["Dairy", "Meat"],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(`/fridges/${id}/favorites/categories`, member.cookie, "PUT", {
          categories: ["unsafe"],
        })
      ).status,
    ).toBe(400);
  });
  it("deduplicates morning jobs and cancels private deliveries when membership or LINE binding is removed", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const owner = await identity();
    const id = await fridge(owner.cookie);
    const code = await pair(owner.cookie);
    const target = "U" + "c".repeat(32);
    await webhook(code.code, { type: "user", userId: target });
    mock.mockClear();
    const time = Math.floor(Date.UTC(2026, 11, 2, 0, 30) / 1000);
    await bindings.DB.prepare(
      `INSERT INTO user_fridge_favorites(fridge_id,user_id,item_key,name_th,name_en,category) VALUES(?,?,'missing','นม','Milk','Dairy')`,
    )
      .bind(id, owner.userId)
      .run();
    await queueMorningDigests(bindings, time);
    await queueMorningDigests(bindings, time);
    const jobs = await bindings.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_line_outbox WHERE user_id=? AND alert_type='morning'",
    )
      .bind(owner.userId)
      .first<{ n: number }>();
    expect(jobs!.n).toBe(1);
    await bindings.DB.prepare(
      "DELETE FROM fridge_members WHERE fridge_id=? AND email=?",
    )
      .bind(id, owner.email)
      .run();
    expect(await dispatchPersonalOutbox(bindings, time)).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("handles unfollow once and ignores stale lifecycle redelivery after a new pairing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const account = await identity();
    const target = "U" + "d".repeat(32);
    const first = await pair(account.cookie);
    await webhook(first.code, { type: "user", userId: target });
    const now = Date.now();
    const eventId = crypto.randomUUID();
    async function lifecycle(id: string, at: number) {
      const body = JSON.stringify({
        events: [
          {
            type: "unfollow",
            webhookEventId: id,
            timestamp: at,
            source: { type: "user", userId: target },
          },
        ],
      });
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
      );
      return exports.default.fetch("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "x-line-signature": btoa(String.fromCharCode(...sig)) },
        body,
      });
    }
    expect((await lifecycle(eventId, now)).status).toBe(200);
    expect(
      (
        (await (await api("/me/line", account.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
    const newer = await pair(account.cookie);
    await webhook(
      newer.code,
      { type: "user", userId: target },
      crypto.randomUUID(),
      secret,
      now + 1,
    );
    expect(
      (
        (await (await api("/me/line", account.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(true);
    await lifecycle(eventId, now);
    await lifecycle(crypto.randomUUID(), now - 1000);
    expect(
      (
        (await (await api("/me/line", account.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(true);
  });

  it("retries personal alerts with the same key, deduplicates gateway retries and cancels opted-out jobs", async () => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    const account = await identity();
    const id = await fridge(account.cookie);
    const code = await pair(account.cookie);
    await webhook(code.code, { type: "user", userId: "U" + "8".repeat(32) });
    upstream.mockReset();
    upstream.mockImplementation(
      async () => new Response("{}", { status: 503 }),
    );
    const time = Math.floor(Date.now() / 1000);
    const sample = {
      node_id: "F0",
      timestamp_s: time,
      temp_celsius: 9,
      voc_index: 1,
      light_ldr: 1,
      battery_pct: 90,
    };
    await personalTelemetryAlerts(bindings, id, [sample], time);
    expect(upstream).toHaveBeenCalledTimes(1);
    const firstKey = new Headers(upstream.mock.calls[0]![1]?.headers).get(
      "X-Line-Retry-Key",
    );
    expect(firstKey).toBeTruthy();
    upstream.mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    expect(await dispatchPersonalOutbox(bindings, time + 31)).toBe(1);
    expect(
      new Headers(upstream.mock.calls[1]![1]?.headers).get("X-Line-Retry-Key"),
    ).toBe(firstKey);
    await personalTelemetryAlerts(bindings, id, [sample], time + 1900);
    expect(upstream).toHaveBeenCalledTimes(2);
    upstream.mockImplementation(
      async () => new Response("{}", { status: 503 }),
    );
    await personalTelemetryAlerts(
      bindings,
      id,
      [{ ...sample, timestamp_s: time + 1901 }],
      time + 1901,
    );
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(
      (await api("/me/line", account.cookie, "PATCH", { inst_warm: false }))
        .status,
    ).toBe(200);
    expect(
      (await api("/me/line", account.cookie, "PATCH", { inst_warm: true }))
        .status,
    ).toBe(200);
    expect(await dispatchPersonalOutbox(bindings, time + 2000)).toBe(0);
    expect(upstream).toHaveBeenCalledTimes(3);
  });
  it("does not let another Google account claim a linked personal LINE and rejects unrelated web origins", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const first = await identity();
    const second = await identity();
    const target = "U" + "9".repeat(32);
    await webhook((await pair(first.cookie)).code, {
      type: "user",
      userId: target,
    });
    await webhook((await pair(second.cookie)).code, {
      type: "user",
      userId: target,
    });
    expect(
      (
        (await (await api("/me/line", first.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(true);
    expect(
      (
        (await (await api("/me/line", second.cookie)).json()) as {
          linked: boolean;
        }
      ).linked,
    ).toBe(false);
    const rejected = await exports.default.fetch(
      "http://localhost/api/me/line/pair",
      {
        method: "POST",
        headers: { Cookie: first.cookie, Origin: "https://untrusted.example" },
      },
    );
    expect(rejected.status).toBe(403);
  });
  it("does not redeem a code after its issuing session has ended and bounds code generation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const account = await identity();
    let issued = await pair(account.cookie);
    for (let i = 0; i < 4; i++) issued = await pair(account.cookie);
    expect((await api("/me/line/pair", account.cookie, "POST")).status).toBe(
      429,
    );
    await bindings.DB.prepare("DELETE FROM session WHERE userId=?")
      .bind(account.userId)
      .run();
    await webhook(issued.code, { type: "user", userId: "U" + "e".repeat(32) });
    expect(
      await bindings.DB.prepare(
        "SELECT line_user_id FROM user_line_profiles WHERE user_id=?",
      )
        .bind(account.userId)
        .first(),
    ).toBeNull();
  });

  it("identifies LINE scope without exposing email or internal IDs in message copy", async () => {
    const sentBodies: Array<{ url: string; body: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      sentBodies.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response("{}", { status: 200 });
    });

    const owner = await identity();
    const fridgeId = await fridge(owner.cookie);

    const personalCode = await pair(owner.cookie, "/me/line/pair");
    expect(
      (
        await webhook(personalCode.code, {
          type: "user",
          userId: "U" + "1".repeat(32),
        })
      ).status,
    ).toBe(200);

    const fridgeCode = await pair(
      owner.cookie,
      `/fridges/${fridgeId}/line/pair`,
    );
    expect(
      (
        await webhook(fridgeCode.code, {
          type: "group",
          userId: "U" + "1".repeat(32),
          groupId: "C" + "2".repeat(32),
        })
      ).status,
    ).toBe(200);

    const personalTest = await api("/me/line/test", owner.cookie, "POST");
    const fridgeTest = await api(
      `/fridges/${fridgeId}/line/test`,
      owner.cookie,
      "POST",
    );
    for (const response of [personalTest, fridgeTest]) {
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        queued: false,
        status: "accepted",
      });
    }

    const replies = sentBodies.filter((entry) => entry.url.endsWith("/reply"));
    const pushes = sentBodies.filter((entry) => entry.url.endsWith("/push"));
    expect(replies).toHaveLength(2);
    expect(pushes).toHaveLength(2);

    expect(replies[0]!.body).toContain("LINE ส่วนตัว");
    expect(replies[0]!.body).not.toContain(owner.email);
    expect(replies[1]!.body).toContain("LINE ของตู้เย็น");
    expect(replies[1]!.body).toContain("Family kitchen");
    expect(replies[1]!.body).not.toContain(fridgeId);

    expect(pushes[0]!.body).toContain("LINE ส่วนตัว");
    expect(pushes[0]!.body).not.toContain(owner.email);
    expect(pushes[0]!.body).not.toContain(fridgeId);

    expect(pushes[1]!.body).toContain("LINE ของตู้เย็น");
    expect(pushes[1]!.body).toContain("Family kitchen");
    expect(pushes[1]!.body).not.toContain(fridgeId);
  });
});
