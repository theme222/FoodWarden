import { Hono } from "hono";
import { getAuthenticatedUser, type AuthenticatedUser } from "./lib/auth";
import { getMemberRole, isValidFridgeId } from "./lib/fridges";
import {
  LinePairingError,
  createPairingCode,
  lineReady,
  lineFriendUrl,
  readLimitedBody,
  verifyLineSignature,
  processLineWebhook,
} from "./lib/line-pairing";
import {
  readLineProfile,
  readFavorites,
  setFavorite,
  validCategories,
  updateLinePreferences,
} from "./lib/personal";
import type { AppBindings } from "./types";
// Delivery helpers use the existing durable outboxes and recheck the recipient at dispatch.
import { enqueuePersonalTest } from "./lib/personal-notifications";
import { enqueueFridgeLineTest } from "./lib/line";
import { notifyFridgeRoom } from "./lib/room";

export const lineRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: { user: AuthenticatedUser };
}>();
lineRoutes.onError((error, c) => {
  if (error instanceof LinePairingError)
    return c.json(
      {
        error:
          error.status === 429
            ? "RATE_LIMITED"
            : error.status === 503
              ? "SERVICE_UNAVAILABLE"
              : "INVALID_PAYLOAD",
        message: error.message,
      },
      error.status,
    );
  return c.json(
    { error: "INTERNAL_ERROR", message: "The request could not be completed." },
    500,
  );
});
lineRoutes.post("/line/webhook", async (c) => {
  if (!lineReady(c.env)) return c.json({ error: "SERVICE_UNAVAILABLE" }, 503);
  const body = await readLimitedBody(c.req.raw, 1_000_000);
  if (!body) return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
  if (
    !(await verifyLineSignature(
      body,
      c.req.header("x-line-signature") ?? null,
      c.env.LINE_CHANNEL_SECRET!.trim(),
    ))
  )
    return c.json({ error: "FORBIDDEN" }, 403);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return c.json({ error: "INVALID_PAYLOAD" }, 400);
  }
  await processLineWebhook(c.env, payload, Math.floor(Date.now() / 1000));
  return c.json({ ok: true });
});
lineRoutes.use("*", async (c, next) => {
  if (
    !/^\/api\/(?:me\/line(?:\/|$)|fridges\/[^/]+\/(?:line|favorites)(?:\/|$))/.test(
      new URL(c.req.url).pathname,
    )
  ) {
    await next();
    return;
  }
  c.header("Cache-Control", "private, no-store");
  const user = await getAuthenticatedUser(c.env, c.req.raw);
  if (!user)
    return c.json(
      { error: "UNAUTHORIZED", message: "Authentication is required." },
      401,
    );
  if (c.req.method !== "GET") {
    const origin = c.req.header("Origin");
    const allowed = new Set([
      new URL(c.env.BETTER_AUTH_URL || c.req.url).origin,
    ]);
    if (c.env.APP_ENV === "development")
      for (const url of [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8787",
        "http://127.0.0.1:8787",
      ])
        allowed.add(url);
    if (origin && !allowed.has(origin))
      return c.json({ error: "FORBIDDEN", message: "Untrusted origin." }, 403);
  }
  c.set("user", user);
  await next();
});
async function jsonInput(request: Request): Promise<Record<string, unknown>> {
  const body = await readLimitedBody(request, 16_384);
  if (!body) throw new LinePairingError("Request is too large.", 400);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* A generic 400 avoids parser detail disclosure. */
  }
  throw new LinePairingError("Invalid JSON payload.", 400);
}
async function membership(
  env: AppBindings,
  user: AuthenticatedUser,
  fridgeId: string,
  owner = false,
): Promise<boolean> {
  if (!isValidFridgeId(fridgeId)) return false;
  const role = await getMemberRole(env.DB, fridgeId, user.email);
  return role !== null && (!owner || role === "owner");
}
lineRoutes.get("/me/line", async (c) => {
  const profile = await readLineProfile(c.env.DB, c.get("user").id);
  return c.json({
    linked: Boolean(profile.line_user_id),
    ready: lineReady(c.env),
    friend_url: lineFriendUrl(c.env),
    morning_enabled: Boolean(profile.morning_enabled),
    morning_time: profile.morning_time,
    inst_obstruct: Boolean(profile.inst_obstruct),
    inst_warm: Boolean(profile.inst_warm),
    inst_spoil: Boolean(profile.inst_spoil),
  });
});
lineRoutes.patch("/me/line", async (c) => {
  if (
    !(await updateLinePreferences(
      c.env,
      c.get("user").id,
      await jsonInput(c.req.raw),
      Math.floor(Date.now() / 1000),
    ))
  )
    return c.json(
      {
        error: "INVALID_PAYLOAD",
        message: "Invalid notification preferences.",
      },
      400,
    );
  return c.json({ ok: true });
});
lineRoutes.post("/me/line/pair", async (c) =>
  c.json(
    await createPairingCode(
      c.env,
      c.get("user"),
      null,
      Math.floor(Date.now() / 1000),
    ),
    201,
  ),
);
lineRoutes.delete("/me/line", async (c) => {
  const id = c.get("user").id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user_line_profiles SET line_user_id=NULL,updated_at_s=? WHERE user_id=?",
    ).bind(Math.floor(Date.now() / 1000), id),
    c.env.DB.prepare(
      "UPDATE line_pairing_codes SET revoked=1 WHERE user_id=? AND scope='user'",
    ).bind(id),
    c.env.DB.prepare(
      "UPDATE user_line_outbox SET failed=1 WHERE user_id=? AND delivered_s IS NULL",
    ).bind(id),
  ]);
  return c.json({ ok: true });
});
lineRoutes.post("/me/line/test", async (c) => {
  if (!lineReady(c.env))
    throw new LinePairingError("LINE is not configured.", 503);
  await enqueuePersonalTest(
    c.env,
    c.get("user").id,
    Math.floor(Date.now() / 1000),
  );
  return c.json({ queued: true }, 202);
});
lineRoutes.get("/fridges/:fridgeId/line", async (c) => {
  const id = c.req.param("fridgeId");
  if (!(await membership(c.env, c.get("user"), id)))
    return c.json({ error: "FORBIDDEN" }, 403);
  const row = await c.env.DB.prepare(
    "SELECT line_target_id FROM fridges WHERE id=?",
  )
    .bind(id)
    .first<{ line_target_id: string | null }>();
  return c.json({
    linked: Boolean(row?.line_target_id),
    kind: row?.line_target_id?.startsWith("U") ? "user" : "group",
    ready: lineReady(c.env),
    friend_url: lineFriendUrl(c.env),
  });
});
lineRoutes.post("/fridges/:fridgeId/line/pair", async (c) => {
  const id = c.req.param("fridgeId");
  if (!(await membership(c.env, c.get("user"), id, true)))
    return c.json({ error: "FORBIDDEN" }, 403);
  return c.json(
    await createPairingCode(
      c.env,
      c.get("user"),
      id,
      Math.floor(Date.now() / 1000),
    ),
    201,
  );
});
lineRoutes.delete("/fridges/:fridgeId/line", async (c) => {
  const user = c.get("user");
  const id = c.req.param("fridgeId");
  if (!(await membership(c.env, user, id, true)))
    return c.json({ error: "FORBIDDEN" }, 403);
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE fridges SET line_target_id=NULL WHERE id=? AND EXISTS(SELECT 1 FROM fridge_members WHERE fridge_id=? AND email=? AND role='owner')",
    ).bind(id, id, user.email),
    c.env.DB.prepare(
      "UPDATE line_pairing_codes SET revoked=1 WHERE fridge_id=? AND NOT EXISTS(SELECT 1 FROM fridges WHERE id=? AND line_target_id IS NOT NULL)",
    ).bind(id, id),
    c.env.DB.prepare(
      "UPDATE line_outbox SET failed=1 WHERE fridge_id=? AND NOT EXISTS(SELECT 1 FROM fridges WHERE id=? AND line_target_id IS NOT NULL)",
    ).bind(id, id),
  ]);
  if (!updated?.meta.changes) return c.json({ error: "FORBIDDEN" }, 403);
  await notifyFridgeRoom(c.env, id, { type: "line_settings_changed" });
  return c.json({ ok: true });
});
lineRoutes.post("/fridges/:fridgeId/line/test", async (c) => {
  const id = c.req.param("fridgeId");
  if (!(await membership(c.env, c.get("user"), id, true)))
    return c.json({ error: "FORBIDDEN" }, 403);
  if (!lineReady(c.env))
    throw new LinePairingError("LINE is not configured.", 503);
  await enqueueFridgeLineTest(c.env, id, Math.floor(Date.now() / 1000));
  return c.json({ queued: true }, 202);
});
lineRoutes.get("/fridges/:fridgeId/favorites", async (c) => {
  const id = c.req.param("fridgeId");
  const user = c.get("user");
  if (!(await membership(c.env, user, id)))
    return c.json({ error: "FORBIDDEN" }, 403);
  return c.json(await readFavorites(c.env.DB, user.id, id));
});
lineRoutes.put("/fridges/:fridgeId/favorites/categories", async (c) => {
  const id = c.req.param("fridgeId");
  const user = c.get("user");
  if (!(await membership(c.env, user, id)))
    return c.json({ error: "FORBIDDEN" }, 403);
  const body = await jsonInput(c.req.raw);
  if (!validCategories(body.categories))
    return c.json({ error: "INVALID_PAYLOAD" }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM user_fridge_fav_categories WHERE fridge_id=? AND user_id=?",
    ).bind(id, user.id),
    ...body.categories.map((category) =>
      c.env.DB.prepare(
        `INSERT INTO user_fridge_fav_categories(fridge_id,user_id,category) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM fridge_members fm JOIN user u ON lower(trim(u.email))=fm.email WHERE fm.fridge_id=? AND u.id=?)`,
      ).bind(id, user.id, category, id, user.id),
    ),
  ]);
  return c.json({ ok: true });
});
lineRoutes.put("/fridges/:fridgeId/favorites/:itemId", async (c) => {
  const id = c.req.param("fridgeId");
  const user = c.get("user");
  if (!(await membership(c.env, user, id)))
    return c.json({ error: "FORBIDDEN" }, 403);
  if (!(await setFavorite(c.env.DB, user.id, id, c.req.param("itemId"))))
    return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ ok: true });
});
lineRoutes.delete("/fridges/:fridgeId/favorites/:key", async (c) => {
  const id = c.req.param("fridgeId");
  const user = c.get("user");
  if (!(await membership(c.env, user, id)))
    return c.json({ error: "FORBIDDEN" }, 403);
  const key = c.req.param("key");
  if (!/^[a-f0-9]{64}$/.test(key))
    return c.json({ error: "INVALID_PAYLOAD" }, 400);
  await c.env.DB.prepare(
    "DELETE FROM user_fridge_favorites WHERE fridge_id=? AND user_id=? AND item_key=?",
  )
    .bind(id, user.id, key)
    .run();
  return c.json({ ok: true });
});
