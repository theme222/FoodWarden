import { notifyFridgeRoom } from "./lib/room";
import { getAuthenticatedUser } from "./lib/auth";
import {
  applyD1Migrations,
  evictDurableObject,
  type D1Migration,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { FridgeRoomEvent } from "./durable-objects/fridge-room";
import { createSignedSessionForEmail } from "./lib/auth";
import type { AppBindings } from "./types";

interface TestEnv extends AppBindings {
  TEST_MIGRATIONS: D1Migration[];
}

function getTestEnv(): TestEnv {
  return env as unknown as TestEnv;
}

async function loginCookie(email: string): Promise<string> {
  const testEnv = getTestEnv();
  const { cookieHeader } = await createSignedSessionForEmail(
    testEnv,
    "http://localhost/",
    { email },
  );
  return cookieHeader.split(";")[0] ?? cookieHeader;
}

interface SocketHarness {
  ws: WebSocket;
  nextMessage: (label?: string) => Promise<string>;
  nextJson: <T = FridgeRoomEvent>(label?: string) => Promise<T>;
  closed: Promise<{ code: number; reason: string }>;
  close: () => void;
}

async function connectFridgeSocket(
  fridgeId: string,
  cookie: string,
): Promise<SocketHarness> {
  const res = await exports.default.fetch(
    `http://localhost/api/fridges/${encodeURIComponent(fridgeId)}/ws`,
    {
      headers: {
        Upgrade: "websocket",
        Cookie: cookie,
      },
    },
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeTruthy();
  if (!ws) {
    throw new Error("Expected WebSocket on 101 response");
  }

  const queue: string[] = [];
  const waiters: Array<(msg: string) => void> = [];

  ws.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : "";
    const waiter = waiters.shift();
    if (waiter) {
      waiter(data);
    } else {
      queue.push(data);
    }
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener("close", (event) => {
      resolve({ code: event.code, reason: event.reason });
    });
  });

  ws.accept();

  const nextMessage = (label = "message") => {
    const buffered = queue.shift();
    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(onMessage);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for WebSocket ${label}`));
      }, 1500);
      const onMessage = (msg: string) => {
        clearTimeout(timer);
        resolve(msg);
      };
      waiters.push(onMessage);
    });
  };

  const nextJson = async <T = FridgeRoomEvent>(label?: string): Promise<T> => {
    const raw = await nextMessage(label);
    return JSON.parse(raw) as T;
  };

  return {
    ws,
    nextMessage,
    nextJson,
    closed,
    close: () => {
      try {
        ws.close(1000, "Done");
      } catch {
        // Ignore already closed socket.
      }
    },
  };
}

describe("FridgeRoom Durable Object WebSocket", () => {
  beforeAll(async () => {
    const testEnv = getTestEnv();
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  it("enforces Upgrade header and fridge membership on /ws", async () => {
    const ownerEmail = `ws-owner-${crypto.randomUUID()}@example.com`;
    const strangerEmail = `ws-stranger-${crypto.randomUUID()}@example.com`;
    const ownerCookie = await loginCookie(ownerEmail);
    const strangerCookie = await loginCookie(strangerEmail);

    const createRes = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        method: "POST",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "WS Auth Fridge" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id: fridgeId } = (await createRes.json()) as { id: string };

    // Missing Upgrade header -> 426.
    const noUpgrade = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/ws`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(noUpgrade.status).toBe(426);

    // Unauthenticated Upgrade -> 401.
    const unauth = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/ws`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(unauth.status).toBe(401);

    // Stranger Upgrade -> 403.
    const forbidden = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/ws`,
      { headers: { Upgrade: "websocket", Cookie: strangerCookie } },
    );
    expect(forbidden.status).toBe(403);

    // Invalid fridgeId -> 404.
    const badId = await exports.default.fetch(
      "http://localhost/api/fridges/bad$id/ws",
      { headers: { Upgrade: "websocket", Cookie: ownerCookie } },
    );
    expect(badId.status).toBe(404);
  });

  it("streams real-time events, auto-responds to ping, and survives DO hibernation", async () => {
    const testEnv = getTestEnv();
    const ownerEmail = `rt-owner-${crypto.randomUUID()}@example.com`;
    const ownerCookie = await loginCookie(ownerEmail);

    const createFridge = async (name: string) => {
      const res = await exports.default.fetch("http://localhost/api/fridges", {
        method: "POST",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const settingsRes = await exports.default.fetch(
        `http://localhost/api/fridges/${id}/settings`,
        { headers: { Cookie: ownerCookie } },
      );
      expect(settingsRes.status).toBe(200);
      const { gateway_token } = (await settingsRes.json()) as {
        gateway_token: string;
      };
      return { id, gateway_token };
    };

    const fridgeA = await createFridge("Fridge A");
    const fridgeB = await createFridge("Fridge B");

    const socket = await connectFridgeSocket(fridgeA.id, ownerCookie);
    try {
      expect(await socket.nextJson("connected")).toEqual({
        type: "connected",
        fridgeId: fridgeA.id,
      });

      socket.ws.send("ping");
      expect(await socket.nextMessage("ping1")).toBe("pong");

      // Telemetry push.
      const nowS = Math.floor(Date.now() / 1000);
      const sample = {
        node_id: "F0",
        timestamp_s: nowS - 2,
        temp_celsius: 3.6,
        voc_index: 95,
        light_ldr: 42,
      };
      const telRes = await exports.default.fetch(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fridgeA.gateway_token}`,
          },
          body: JSON.stringify({ samples: [sample] }),
        },
      );
      expect(telRes.status).toBe(200);
      const telMsg = await socket.nextJson("telemetry");
      expect(telMsg).toMatchObject({
        type: "telemetry",
        samples: [sample],
      });

      // Status push.
      const statRes = await exports.default.fetch(
        "http://localhost/api/status",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fridgeA.gateway_token}`,
          },
          body: JSON.stringify({
            nodes: [{ node_id: "C0", last_seen_s: nowS - 1 }],
          }),
        },
      );
      expect(statRes.status).toBe(200);
      expect(await socket.nextJson("status")).toMatchObject({
        type: "status",
        status: {
          gateway_seen_s: nowS - 1,
          nodes: [
            {
              node_id: "C0",
              last_seen_s: nowS - 1,
              last_known_seen_s: nowS - 1,
            },
          ],
        },
      });

      // Door events push.
      const doorEvent = {
        node_id: "D0",
        timestamp_s: nowS,
        status: "SUCCESS" as const,
      };
      const doorRes = await exports.default.fetch(
        "http://localhost/api/door_events",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fridgeA.gateway_token}`,
          },
          body: JSON.stringify({ events: [doorEvent] }),
        },
      );
      expect(doorRes.status).toBe(200);
      expect(await socket.nextJson("door_events")).toEqual({
        type: "door_events",
        events: [doorEvent],
      });

      // Inventory create / patch / delete pushes.
      const itemId = crypto.randomUUID();
      const addRes = await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeA.id}/inventory`,
        {
          method: "POST",
          headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: itemId,
            name: "Soy Milk",
            category: "Dairy",
            estimated_expiry_date: "2026-12-01",
          }),
        },
      );
      expect(addRes.status).toBe(201);
      expect(await socket.nextJson("inv-created")).toEqual({
        type: "inventory_changed",
        action: "created",
        itemId,
      });

      const patchRes = await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeA.id}/inventory/${itemId}`,
        {
          method: "PATCH",
          headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
          body: JSON.stringify({ name_en: "Oat Milk" }),
        },
      );
      expect(patchRes.status).toBe(200);
      expect(await socket.nextJson("inv-updated")).toEqual({
        type: "inventory_changed",
        action: "updated",
        itemId,
      });

      const delItemRes = await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeA.id}/inventory/${itemId}`,
        {
          method: "DELETE",
          headers: { Cookie: ownerCookie },
        },
      );
      expect(delItemRes.status).toBe(200);
      expect(await socket.nextJson("inv-deleted")).toEqual({
        type: "inventory_changed",
        action: "deleted",
        itemId,
      });

      // Evict DO to simulate hibernation, then verify ping & telemetry push still work.
      const stub = testEnv.FRIDGE_ROOM.get(
        testEnv.FRIDGE_ROOM.idFromName(fridgeA.id),
      );
      await evictDurableObject(stub);

      socket.ws.send("ping");
      expect(await socket.nextMessage("ping2")).toBe("pong");

      // Event in Fridge B must not leak into Fridge A; subsequent Fridge A telemetry arrives first.
      const otherSample = { ...sample, timestamp_s: nowS - 10 };
      const otherRes = await exports.default.fetch(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fridgeB.gateway_token}`,
          },
          body: JSON.stringify({ samples: [otherSample] }),
        },
      );
      expect(otherRes.status).toBe(200);

      const postEvictSample = { ...sample, timestamp_s: nowS + 5 };
      const tel2Res = await exports.default.fetch(
        "http://localhost/api/telemetry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fridgeA.gateway_token}`,
          },
          body: JSON.stringify({ samples: [postEvictSample] }),
        },
      );
      expect(tel2Res.status).toBe(200);
      expect(await socket.nextJson("post-evict-telemetry")).toMatchObject({
        type: "telemetry",
        samples: [postEvictSample],
      });
    } finally {
      socket.close();
    }
  });

  it("closes sockets immediately on member revocation (4003) and fridge deletion (4004)", async () => {
    const ownerEmail = `close-owner-${crypto.randomUUID()}@example.com`;
    const memberEmail = `close-member-${crypto.randomUUID()}@example.com`;
    const ownerCookie = await loginCookie(ownerEmail);
    const memberCookie = await loginCookie(memberEmail);

    const createRes = await exports.default.fetch(
      "http://localhost/api/fridges",
      {
        method: "POST",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lifecycle Fridge" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id: fridgeId } = (await createRes.json()) as { id: string };

    const inviteRes = await exports.default.fetch(
      `http://localhost/api/fridges/${fridgeId}/members`,
      {
        method: "POST",
        headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail, role: "member" }),
      },
    );
    expect(inviteRes.status).toBe(201);

    const ownerSocket = await connectFridgeSocket(fridgeId, ownerCookie);
    const memberSocket = await connectFridgeSocket(fridgeId, memberCookie);
    try {
      expect(await ownerSocket.nextJson()).toEqual({
        type: "connected",
        fridgeId,
      });
      expect(await memberSocket.nextJson()).toEqual({
        type: "connected",
        fridgeId,
      });

      // Revoking member closes only member's socket with 4003.
      const revokeRes = await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeId}/members/${encodeURIComponent(memberEmail)}`,
        {
          method: "DELETE",
          headers: { Cookie: ownerCookie },
        },
      );
      expect(revokeRes.status).toBe(200);

      expect(await memberSocket.closed).toEqual({
        code: 4003,
        reason: "Access revoked",
      });

      // Owner socket remains alive.
      ownerSocket.ws.send("ping");
      expect(await ownerSocket.nextMessage()).toBe("pong");

      // Deleting fridge closes owner socket with 4004.
      const delRes = await exports.default.fetch(
        `http://localhost/api/fridges/${fridgeId}`,
        {
          method: "DELETE",
          headers: { Cookie: ownerCookie },
        },
      );
      expect(delRes.status).toBe(200);
      expect(await ownerSocket.closed).toEqual({
        code: 4004,
        reason: "Fridge deleted",
      });
    } finally {
      memberSocket.close();
      ownerSocket.close();
    }
  });

  for (const mode of ["logout", "expiry", "membership"] as const) {
    it(
      "stops private delivery after " +
        mode +
        " even without a revocation broadcast",
      async () => {
        const testEnv = getTestEnv();
        const email = "lifecycle-" + crypto.randomUUID() + "@example.com";
        const cookie = await loginCookie(email);
        const create = await exports.default.fetch(
          "http://localhost/api/fridges",
          {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Lifecycle" }),
          },
        );
        const { id } = (await create.json()) as { id: string };
        const socket = await connectFridgeSocket(id, cookie);
        await socket.nextJson();
        if (mode === "logout")
          await testEnv.DB.prepare(
            "DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email = ?)",
          )
            .bind(email)
            .run();
        if (mode === "expiry")
          await testEnv.DB.prepare(
            "UPDATE session SET expiresAt = ? WHERE userId IN (SELECT id FROM user WHERE email = ?)",
          )
            .bind(new Date(Date.now() - 1000).toISOString(), email)
            .run();
        if (mode === "membership")
          await testEnv.DB.prepare(
            "DELETE FROM fridge_members WHERE fridge_id = ? AND email = ?",
          )
            .bind(id, email)
            .run();
        await notifyFridgeRoom(testEnv, id, {
          type: "inventory_changed",
          action: "created",
          itemId: "private",
        });
        expect((await socket.closed).code).toBe(4003);
        socket.close();
      },
    );
  }
  it("rejects a delayed authorized handshake after membership removal", async () => {
    const testEnv = getTestEnv();
    const email = "delayed-" + crypto.randomUUID() + "@example.com";
    const cookie = await loginCookie(email);
    const request = new Request("http://localhost/", {
      headers: { Cookie: cookie },
    });
    const user = await getAuthenticatedUser(testEnv, request);
    expect(user).toBeTruthy();
    const create = await exports.default.fetch("http://localhost/api/fridges", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Delayed" }),
    });
    const { id } = (await create.json()) as { id: string };
    await testEnv.DB.prepare(
      "DELETE FROM fridge_members WHERE fridge_id = ? AND email = ?",
    )
      .bind(id, email)
      .run();
    const stub = testEnv.FRIDGE_ROOM.get(testEnv.FRIDGE_ROOM.idFromName(id));
    const result = await stub.fetch("http://fridge-room/ws", {
      headers: {
        Upgrade: "websocket",
        "x-fw-user-email": email,
        "x-fw-user-id": user!.id,
        "x-fw-session-id": user!.sessionId,
        "x-fw-fridge-id": id,
      },
    });
    expect(result.status).toBe(401);
  });

  it("normalizes verified email case and revalidates numeric expiry attachments", async () => {
    const testEnv = getTestEnv();
    const email = "mixed-" + crypto.randomUUID() + "@example.com";
    const cookie = await loginCookie(email);
    const create = await exports.default.fetch("http://localhost/api/fridges", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Email case" }),
    });
    const { id } = (await create.json()) as { id: string };
    await testEnv.DB.prepare("UPDATE user SET email = ? WHERE email = ?")
      .bind(email.toUpperCase(), email)
      .run();
    const socket = await connectFridgeSocket(id, cookie);
    await socket.nextJson();
    await testEnv.DB.prepare(
      "UPDATE session SET expiresAt = ? WHERE userId IN (SELECT id FROM user WHERE email = ?)",
    )
      .bind(Date.now() + 60_000, email.toUpperCase())
      .run();
    socket.ws.send("ping");
    expect(await socket.nextMessage()).toBe("pong");
    await testEnv.DB.prepare(
      "UPDATE session SET expiresAt = ? WHERE userId IN (SELECT id FROM user WHERE email = ?)",
    )
      .bind(Math.floor(Date.now() / 1000) - 1, email.toUpperCase())
      .run();
    socket.ws.send("ping");
    expect((await socket.closed).code).toBe(4003);
    socket.close();
  });
});
