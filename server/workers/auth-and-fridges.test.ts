import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createSignedSessionForEmail } from "./lib/auth";
import type { AppBindings } from "./types";

interface TestEnv extends AppBindings {
  TEST_MIGRATIONS: D1Migration[];
}

function getTestEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function loginCookie(
  email: string,
  options?: { emailVerified?: boolean; expiresInMs?: number },
) {
  const testEnv = getTestEnv();
  const { cookieHeader } = await createSignedSessionForEmail(
    testEnv,
    "http://localhost/",
    {
      email,
      emailVerified: options?.emailVerified,
      expiresInMs: options?.expiresInMs,
    },
  );
  return cookieHeader.split(";")[0] ?? cookieHeader;
}

describe("Better Auth, fridge RBAC, and inventory CRUD", () => {
  beforeAll(async () => {
    const testEnv = getTestEnv();
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  it("exposes Better Auth health/config and rejects unauthenticated, unverified, or expired sessions", async () => {
    const okRes = await exports.default.fetch("http://localhost/api/auth/ok");
    expect(okRes.status).toBe(200);

    const configRes = await exports.default.fetch(
      "http://localhost/api/auth/config",
    );
    expect(configRes.status).toBe(200);
    expect(await configRes.json()).toEqual({
      googleEnabled: false,
      devLoginEnabled: false,
    });

    // dev-login is disabled unless DEV_AUTH_BYPASS_EMAIL is configured in development.
    const devLoginRes = await exports.default.fetch(
      "http://localhost/api/auth/dev-login",
      {
        method: "POST",
      },
    );
    expect(devLoginRes.status).toBe(404);

    // Unauthenticated request returns 401.
    expect(
      (await exports.default.fetch("http://localhost/api/fridges")).status,
    ).toBe(401);

    // Unverified email is rejected.
    const unverifiedCookie = await loginCookie(
      `unverified-${crypto.randomUUID()}@example.com`,
      {
        emailVerified: false,
      },
    );
    expect(
      (
        await exports.default.fetch("http://localhost/api/fridges", {
          headers: { Cookie: unverifiedCookie },
        })
      ).status,
    ).toBe(401);

    // Expired session is rejected.
    const expiredCookie = await loginCookie(
      `expired-${crypto.randomUUID()}@example.com`,
      {
        expiresInMs: -60_000,
      },
    );
    expect(
      (
        await exports.default.fetch("http://localhost/api/fridges", {
          headers: { Cookie: expiredCookie },
        })
      ).status,
    ).toBe(401);

    // Vite dev server origin (localhost:5173) is trusted for POST /api/auth/sign-out in development.
    const validCookie = await loginCookie(
      `signout-${crypto.randomUUID()}@example.com`,
    );
    const signOutRes = await exports.default.fetch(
      "http://localhost:8787/api/auth/sign-out",
      {
        method: "POST",
        headers: {
          Cookie: validCookie,
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    expect(signOutRes.status).toBe(200);
  });

  it("creates fridges, enforces owner vs member RBAC, rotates gateway tokens, and cleans up on delete", async () => {
    const testEnv = getTestEnv();
    const ownerEmail = `owner-${crypto.randomUUID()}@example.com`;
    const memberEmail = `member-${crypto.randomUUID()}@example.com`;
    const strangerEmail = `stranger-${crypto.randomUUID()}@example.com`;

    const ownerCookie = await loginCookie(ownerEmail);
    const memberCookie = await loginCookie(memberEmail);
    const strangerCookie = await loginCookie(strangerEmail);

    // Create fridge as owner.
    const createRes = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        method: "POST",
        headers: {
          Cookie: ownerCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Kitchen Smart Fridge" }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      name: string;
      role: string;
    };
    expect(created.name).toBe("Kitchen Smart Fridge");
    expect(created.role).toBe("owner");

    // Owner sees the fridge in /api/fridges.
    const listOwnerRes = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        headers: { Cookie: ownerCookie },
      },
    );
    expect(listOwnerRes.status).toBe(200);
    const ownerList = (await listOwnerRes.json()) as {
      fridges: Array<{ id: string; name: string; role: string }>;
    };
    expect(ownerList.fridges.map((f) => f.id)).toContain(created.id);

    // Owner reads settings and gateway token.
    const settingsRes = await exports.default.fetch(
      `http://localhost/api/fridges/${created.id}/settings`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(settingsRes.status).toBe(200);
    const settings = (await settingsRes.json()) as {
      gateway_token: string;
      has_gemini_api_key: boolean;
      members: Array<{ email: string; role: string }>;
    };
    expect(settings.gateway_token.startsWith("fw_gw_")).toBe(true);
    expect(settings.has_gemini_api_key).toBe(false);

    // Invite member.
    const inviteRes = await exports.default.fetch(
      `http://localhost/api/fridges/${created.id}/members`,
      {
        method: "POST",
        headers: {
          Cookie: ownerCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: memberEmail, role: "member" }),
      },
    );
    expect(inviteRes.status).toBe(201);

    // Member can read inventory, but is forbidden from settings, member edits, token rotation, rename, or delete.
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/inventory`,
          {
            headers: { Cookie: memberCookie },
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/settings`,
          {
            headers: { Cookie: memberCookie },
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/gateway-token/rotate`,
          { method: "POST", headers: { Cookie: memberCookie } },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}`,
          {
            method: "PATCH",
            headers: {
              Cookie: memberCookie,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: "Hacked" }),
          },
        )
      ).status,
    ).toBe(403);

    // Stranger cannot even read inventory.
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/inventory`,
          {
            headers: { Cookie: strangerCookie },
          },
        )
      ).status,
    ).toBe(403);

    // Cannot remove or demote last owner.
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/members/${encodeURIComponent(ownerEmail)}`,
          { method: "DELETE", headers: { Cookie: ownerCookie } },
        )
      ).status,
    ).toBe(409);

    // Owner updates Gemini key & LINE target ID.
    const putSettingsRes = await exports.default.fetch(
      `http://localhost/api/fridges/${created.id}/settings`,
      {
        method: "PUT",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Upstairs Fridge",
          gemini_api_key: "AIzaSyTestKey",
        }),
      },
    );
    expect(putSettingsRes.status).toBe(200);
    const updatedSettings = (await putSettingsRes.json()) as {
      name: string;
      line_target_id: string;
      has_gemini_api_key: boolean;
    };
    expect(updatedSettings.name).toBe("Upstairs Fridge");
    expect(updatedSettings.line_target_id).toBeNull();
    expect(updatedSettings.has_gemini_api_key).toBe(true);

    // Gateway token rotation invalidates old token and activates new token.
    const rotateRes = await exports.default.fetch(
      `http://localhost/api/fridges/${created.id}/gateway-token/rotate`,
      { method: "POST", headers: { Cookie: ownerCookie } },
    );
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as { gateway_token: string };
    expect(rotated.gateway_token).not.toBe(settings.gateway_token);

    const statusPayload = JSON.stringify({
      nodes: [{ node_id: "C0", last_seen_s: Math.floor(Date.now() / 1000) }],
    });
    expect(
      (
        await exports.default.fetch("http://localhost/api/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.gateway_token}`,
          },
          body: statusPayload,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await exports.default.fetch("http://localhost/api/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${rotated.gateway_token}`,
          },
          body: statusPayload,
        })
      ).status,
    ).toBe(200);

    // Removing member revokes access immediately.
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/members/${encodeURIComponent(memberEmail)}`,
          { method: "DELETE", headers: { Cookie: ownerCookie } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}/inventory`,
          {
            headers: { Cookie: memberCookie },
          },
        )
      ).status,
    ).toBe(403);

    // Delete fridge cleans up D1.
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${created.id}`,
          {
            method: "DELETE",
            headers: { Cookie: ownerCookie },
          },
        )
      ).status,
    ).toBe(200);
    const remaining = await testEnv.DB.prepare(
      "SELECT id FROM fridges WHERE id = ?",
    )
      .bind(created.id)
      .first();
    expect(remaining).toBeNull();
  });

  it("handles manual inventory add, idempotency, R2 photo fetch, FEFO sorting, patch, delete, and dashboard reads", async () => {
    const testEnv = getTestEnv();
    const ownerEmail = `inv-${crypto.randomUUID()}@example.com`;
    const ownerCookie = await loginCookie(ownerEmail);

    const createRes = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        method: "POST",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Inventory Fridge" }),
      },
    );
    const { id: fridgeId } = (await createRes.json()) as { id: string };
    const { gateway_token: gatewayToken } = (await (
      await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeId}/settings`,
        {
          headers: { Cookie: ownerCookie },
        },
      )
    ).json()) as { gateway_token: string };

    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9,
    ]);
    const jpegBase64 = Buffer.from(jpegBytes).toString("base64");
    const itemAId = "11111111-1111-4111-8111-111111111111";
    const itemBId = "22222222-2222-4222-8222-222222222222";
    const todayBangkok = Date.now() + 7 * 3600_000;
    const expiryAfter = (days: number) =>
      new Date(todayBangkok + days * 86_400_000).toISOString().slice(0, 10);

    const addA = (payload: Record<string, unknown>) =>
      exports.default.fetch(
        `http://localhost/api/fridges/${fridgeId}/inventory`,
        {
          method: "POST",
          headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

    // Later expiry added first.
    const resA1 = await addA({
      item_id: itemAId,
      name: "Pasteurized Milk",
      estimated_expiry_date: expiryAfter(4),
      category: "Dairy",
      jpeg_base64: jpegBase64,
    });
    expect(resA1.status).toBe(201);

    // Exact retry returns 200 idempotently.
    const resA2 = await addA({
      item_id: itemAId,
      name: "Pasteurized Milk",
      estimated_expiry_date: expiryAfter(4),
      category: "Dairy",
      jpeg_base64: jpegBase64,
    });
    expect(resA2.status).toBe(200);

    // Conflicting payload for same item_id returns 409.
    const conflict = await addA({
      item_id: itemAId,
      name: "Different Item",
      estimated_expiry_date: expiryAfter(4),
      category: "Dairy",
    });
    expect(conflict.status).toBe(409);

    // Earlier expiry added second -> should sort first (FEFO).
    const resB = await addA({
      item_id: itemBId,
      name: "Yogurt",
      estimated_expiry_date: expiryAfter(3),
      category: "Dairy",
    });
    expect(resB.status).toBe(201);

    const fridgeList = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        headers: { Cookie: ownerCookie },
      },
    );
    const summaries = (await fridgeList.json()) as {
      fridges: { id: string }[];
    };
    expect(
      summaries.fridges.find((fridge) => fridge.id === fridgeId),
    ).toMatchObject({
      inventory_count: 2,
      expiring_soon_count: 1,
    });

    const listRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/inventory`,
      { headers: { Cookie: ownerCookie } },
    );
    const listData = (await listRes.json()) as {
      items: Array<{ id: string; image_storage_path: string | null }>;
    };
    expect(listData.items.map((item) => item.id)).toEqual([itemBId, itemAId]);
    const photoPath = listData.items[1]?.image_storage_path;
    expect(photoPath).toBeTruthy();

    // Private photo endpoint serves JPEG with nosniff.
    const photoRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/inventory/${itemAId}/photo`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(photoRes.status).toBe(200);
    expect(photoRes.headers.get("Content-Type")).toBe("image/jpeg");
    expect(photoRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await photoRes.arrayBuffer())).toEqual(jpegBytes);

    // Patch expiry date.
    const patchRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/inventory/${itemAId}`,
      {
        method: "PATCH",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ estimated_expiry_date: expiryAfter(5) }),
      },
    );
    expect(patchRes.status).toBe(200);

    // Delete item removes D1 row AND R2 photo.
    const deleteRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/inventory/${itemAId}`,
      { method: "DELETE", headers: { Cookie: ownerCookie } },
    );
    expect(deleteRes.status).toBe(200);
    expect(
      (
        await exports.default.fetch(
          `http://localhost/api/fridges/${fridgeId}/inventory/${itemAId}/photo`,
          { headers: { Cookie: ownerCookie } },
        )
      ).status,
    ).toBe(404);
    const r2Key = (photoPath ?? "").replace(/^\/storage\//, "");
    expect(await testEnv.PHOTOS.get(r2Key)).toBeNull();

    // Dashboard telemetry / status / door_events reads reflect gateway writes.
    const nowS = Math.floor(Date.now() / 1000);
    await exports.default.fetch("http://localhost/api/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        samples: [
          {
            node_id: "F0",
            timestamp_s: nowS - 10,
            temp_celsius: 3.5,
            voc_index: 95,
            light_ldr: 10,
          },
        ],
      }),
    });
    await exports.default.fetch("http://localhost/api/door_events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        events: [{ node_id: "D0", timestamp_s: nowS - 5, status: "SUCCESS" }],
      }),
    });

    const telRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/telemetry?range=1h`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(telRes.status).toBe(200);
    expect(
      ((await telRes.json()) as { samples: unknown[] }).samples.length,
    ).toBe(1);

    const doorRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/door_events`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(doorRes.status).toBe(200);
    expect(
      ((await doorRes.json()) as { events: unknown[] }).events.length,
    ).toBe(1);

    const activityUrl = `http://localhost/api/fridges/${fridgeId}/activity`;
    const queryActivity = (query: string) =>
      exports.default.fetch(activityUrl + query, {
        headers: { Cookie: ownerCookie },
      });
    const activity = await queryActivity("?kind=inventory");
    expect(activity.status).toBe(200);
    expect(
      ((await activity.json()) as { rows: { action: string }[] }).rows.map(
        (row) => row.action,
      ),
    ).toEqual(["deleted", "updated", "created", "created"]);
    expect((await exports.default.fetch(activityUrl)).status).toBe(401);
    expect((await queryActivity("?date=2026-02-30")).status).toBe(400);

    await testEnv.DB.batch(
      Array.from({ length: 16 }, (_, index) =>
        testEnv.DB.prepare(
          "INSERT INTO door_events (fridge_id, node_id, timestamp_s, status) VALUES (?, ?, ?, 'SUCCESS')",
        ).bind(fridgeId, "D" + (index + 1), nowS - 5),
      ),
    );
    const bangkokDay = new Date((nowS - 5 + 7 * 3600) * 1000)
      .toISOString()
      .slice(0, 10);
    const filter = "?kind=door&date=" + bangkokDay;
    const first = (await (await queryActivity(filter)).json()) as {
      rows: { id: number }[];
      next: string;
    };
    const second = (await (
      await queryActivity(filter + "&before=" + first.next)
    ).json()) as { rows: { id: number }[]; next: null };
    expect(first.rows).toHaveLength(15);
    expect(second.rows).toHaveLength(2);
    expect(second.next).toBeNull();
    expect(
      new Set([...first.rows, ...second.rows].map((row) => row.id)).size,
    ).toBe(17);

    const emptyStatusRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/status`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(emptyStatusRes.status).toBe(200);
    expect(await emptyStatusRes.json()).toEqual({ status: null });

    await exports.default.fetch("http://localhost/api/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        nodes: [{ node_id: "C0", last_seen_s: nowS - 2 }],
      }),
    });

    const statusRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/status`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(statusRes.status).toBe(200);
    expect(
      ((await statusRes.json()) as { status: { gateway_seen_s: number } })
        .status.gateway_seen_s,
    ).toBe(nowS - 2);
  });
});
