import { Hono, type Context } from "hono";
import {
  createAuth,
  createSignedSessionForEmail,
  getAuthenticatedUser,
  isDevBypassEnabled,
  isGoogleAuthEnabled,
  type AuthenticatedUser,
} from "./lib/auth";
import { ingestDoorEvents, parseDoorEvents } from "./lib/door-events";
import {
  createFridge,
  deleteFridge,
  getFridgeSettings,
  getMemberRole,
  isValidFridgeId,
  listUserFridges,
  normalizeEmail,
  removeFridgeMember,
  rotateGatewayToken,
  updateFridgeSettings,
  upsertFridgeMember,
  type MemberRole,
} from "./lib/fridges";
import {
  extractBearerToken,
  findGatewayFridgeId,
  sha256Hex,
} from "./lib/gateway";
import {
  addManualFood,
  deleteInventoryItem,
  getLatestStatus,
  listDoorEvents,
  listInventory,
  parseInventoryPatch,
  parseManualFood,
  queryTelemetryHistory,
  readInventoryPhoto,
  updateInventoryItem,
} from "./lib/inventory";
import { ingestStatus, parseStatus } from "./lib/status";
import { ingestTelemetry, parseTelemetry } from "./lib/telemetry";
import type { ApiErrorEnvelope, AppBindings } from "./types";

export { FridgeRoom } from "./durable-objects/fridge-room";

export const app = new Hono<{ Bindings: AppBindings }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJsonBody(
  c: Context<{ Bindings: AppBindings }>,
): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

async function requireGatewayFridge(
  c: Context<{ Bindings: AppBindings }>,
): Promise<string | Response> {
  if (c.req.method !== "POST") {
    c.header("Allow", "POST");
    return c.json<ApiErrorEnvelope>(
      { error: "METHOD_NOT_ALLOWED", message: "Use POST for gateway reports." },
      405,
    );
  }

  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    return c.json<ApiErrorEnvelope>(
      { error: "UNAUTHORIZED", message: "A Bearer token is required." },
      401,
    );
  }

  const tokenHash = await sha256Hex(token);
  const fridgeId = await findGatewayFridgeId(c.env.DB, tokenHash);
  if (!fridgeId) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_TOKEN", message: "The gateway token is invalid." },
      403,
    );
  }

  return fridgeId;
}

async function requireUser(
  c: Context<{ Bindings: AppBindings }>,
): Promise<AuthenticatedUser | Response> {
  c.header("Cache-Control", "private, no-store");
  const user = await getAuthenticatedUser(c.env, c.req.raw);
  if (!user) {
    return c.json<ApiErrorEnvelope>(
      { error: "UNAUTHORIZED", message: "Authentication is required." },
      401,
    );
  }
  return user;
}

async function requireFridgeRole(
  c: Context<{ Bindings: AppBindings }>,
  required: MemberRole | "any",
): Promise<
  { user: AuthenticatedUser; fridgeId: string; role: MemberRole } | Response
> {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const fridgeId = c.req.param("fridgeId") ?? "";
  if (!isValidFridgeId(fridgeId)) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Fridge not found." },
      404,
    );
  }

  const role = await getMemberRole(c.env.DB, fridgeId, user.email);
  if (!role || (required === "owner" && role !== "owner")) {
    return c.json<ApiErrorEnvelope>(
      { error: "FORBIDDEN", message: "Insufficient fridge permissions." },
      403,
    );
  }

  return { user, fridgeId, role };
}

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  if (row?.ok !== 1) {
    return c.json<ApiErrorEnvelope>(
      { error: "INTERNAL_ERROR", message: "Database health check failed." },
      500,
    );
  }
  return c.json({ ok: true, database: "ok" });
});

app.get("/api/auth/config", (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({
    googleEnabled: isGoogleAuthEnabled(c.env),
    devLoginEnabled: isDevBypassEnabled(c.env),
  });
});

app.post("/api/auth/dev-login", async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (!isDevBypassEnabled(c.env)) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Unknown API route." },
      404,
    );
  }

  const email = normalizeEmail(c.env.DEV_AUTH_BYPASS_EMAIL ?? "");
  if (!email) {
    return c.json<ApiErrorEnvelope>(
      { error: "INTERNAL_ERROR", message: "DEV_AUTH_BYPASS_EMAIL is invalid." },
      500,
    );
  }

  const { cookieHeader } = await createSignedSessionForEmail(c.env, c.req.url, {
    email,
    name: "Local Developer",
  });
  c.header("Set-Cookie", cookieHeader);
  return c.json({ ok: true, email });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return createAuth(c.env, c.req.url).handler(c.req.raw);
});

app.get("/api/fridges", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const fridges = await listUserFridges(c.env.DB, user.email);
  return c.json({ fridges });
});

app.post("/api/fridges", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;

  const body = await parseJsonBody(c);
  const rawName = isRecord(body) ? body.name : undefined;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.length > 80) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Fridge name must be 1 to 80 characters.",
      },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const created = await createFridge(c.env.DB, user.email, name, nowS);
  return c.json(created, 201);
});

app.patch("/api/fridges/:fridgeId", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  if (!isRecord(body)) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Expected JSON object." },
      400,
    );
  }

  let name: string | undefined;
  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 80
    ) {
      return c.json<ApiErrorEnvelope>(
        {
          error: "INVALID_PAYLOAD",
          message: "Fridge name must be 1 to 80 characters.",
        },
        400,
      );
    }
    name = body.name.trim();
  }

  let lineTargetId: string | null | undefined;
  if (body.line_target_id !== undefined) {
    if (body.line_target_id === null || body.line_target_id === "") {
      lineTargetId = null;
    } else if (
      typeof body.line_target_id === "string" &&
      body.line_target_id.trim().length <= 128
    ) {
      lineTargetId = body.line_target_id.trim();
    } else {
      return c.json<ApiErrorEnvelope>(
        { error: "INVALID_PAYLOAD", message: "Invalid line_target_id." },
        400,
      );
    }
  }

  if (name === undefined && lineTargetId === undefined) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "No editable fields provided." },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  await updateFridgeSettings(
    c.env.DB,
    auth.fridgeId,
    { name, line_target_id: lineTargetId },
    nowS,
  );
  return c.json({ ok: true });
});

app.delete("/api/fridges/:fridgeId", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  await deleteFridge(c.env.DB, c.env.PHOTOS, auth.fridgeId);
  return c.json({ ok: true, deleted: true });
});

app.get("/api/fridges/:fridgeId/settings", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const settings = await getFridgeSettings(c.env.DB, auth.fridgeId);
  if (!settings) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Fridge not found." },
      404,
    );
  }
  return c.json(settings);
});

app.put("/api/fridges/:fridgeId/settings", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  if (!isRecord(body)) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Expected JSON object." },
      400,
    );
  }

  let name: string | undefined;
  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 80
    ) {
      return c.json<ApiErrorEnvelope>(
        {
          error: "INVALID_PAYLOAD",
          message: "Fridge name must be 1 to 80 characters.",
        },
        400,
      );
    }
    name = body.name.trim();
  }

  let lineTargetId: string | null | undefined;
  if (body.line_target_id !== undefined) {
    if (body.line_target_id === null || body.line_target_id === "") {
      lineTargetId = null;
    } else if (
      typeof body.line_target_id === "string" &&
      body.line_target_id.trim().length <= 128
    ) {
      lineTargetId = body.line_target_id.trim();
    } else {
      return c.json<ApiErrorEnvelope>(
        { error: "INVALID_PAYLOAD", message: "Invalid line_target_id." },
        400,
      );
    }
  }

  let geminiApiKey: string | null | undefined;
  if (body.gemini_api_key !== undefined) {
    if (body.gemini_api_key === null || body.gemini_api_key === "") {
      geminiApiKey = null;
    } else if (
      typeof body.gemini_api_key === "string" &&
      body.gemini_api_key.trim().length <= 256
    ) {
      geminiApiKey = body.gemini_api_key.trim();
    } else {
      return c.json<ApiErrorEnvelope>(
        { error: "INVALID_PAYLOAD", message: "Invalid gemini_api_key." },
        400,
      );
    }
  }

  if (
    name === undefined &&
    lineTargetId === undefined &&
    geminiApiKey === undefined
  ) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "No settings fields provided." },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  await updateFridgeSettings(
    c.env.DB,
    auth.fridgeId,
    { name, line_target_id: lineTargetId, gemini_api_key: geminiApiKey },
    nowS,
  );
  const updated = await getFridgeSettings(c.env.DB, auth.fridgeId);
  return c.json(updated);
});

app.post("/api/fridges/:fridgeId/gateway-token/rotate", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const nowS = Math.floor(Date.now() / 1000);
  const gatewayToken = await rotateGatewayToken(c.env.DB, auth.fridgeId, nowS);
  return c.json({ gateway_token: gatewayToken });
});

app.post("/api/fridges/:fridgeId/members", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  if (!isRecord(body) || typeof body.email !== "string") {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Expected member email." },
      400,
    );
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Invalid email address." },
      400,
    );
  }

  const role: MemberRole = body.role === "owner" ? "owner" : "member";
  if (
    body.role !== undefined &&
    body.role !== "owner" &&
    body.role !== "member"
  ) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Role must be owner or member." },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const status = await upsertFridgeMember(
    c.env.DB,
    auth.fridgeId,
    email,
    role,
    nowS,
  );
  if (status === "last_owner") {
    return c.json<ApiErrorEnvelope>(
      { error: "CONFLICT", message: "Cannot demote the last fridge owner." },
      409,
    );
  }
  return c.json({ ok: true, email, role }, 201);
});

app.delete("/api/fridges/:fridgeId/members/:email", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const email = normalizeEmail(decodeURIComponent(c.req.param("email") ?? ""));
  if (!email) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Invalid member email." },
      400,
    );
  }

  const outcome = await removeFridgeMember(c.env.DB, auth.fridgeId, email);
  if (outcome === "not_found") {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Member not found." },
      404,
    );
  }
  if (outcome === "last_owner") {
    return c.json<ApiErrorEnvelope>(
      { error: "CONFLICT", message: "Cannot remove the last fridge owner." },
      409,
    );
  }
  return c.json({ ok: true, deleted: true });
});

app.get("/api/fridges/:fridgeId/inventory", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const items = await listInventory(c.env.DB, auth.fridgeId);
  return c.json({ items });
});

app.post("/api/fridges/:fridgeId/inventory", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  const food = parseManualFood(body);
  if (!food) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid manual food item.",
      },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const outcome = await addManualFood(
    c.env.DB,
    c.env.PHOTOS,
    auth.fridgeId,
    food,
    nowS,
  );
  if (outcome === "conflict") {
    return c.json<ApiErrorEnvelope>(
      {
        error: "CONFLICT",
        message: "Item ID already exists with different data.",
      },
      409,
    );
  }
  return c.json({ item_id: food.itemId }, outcome === "created" ? 201 : 200);
});

app.patch("/api/fridges/:fridgeId/inventory/:itemId", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const itemId = c.req.param("itemId") ?? "";
  if (!isValidFridgeId(itemId)) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }

  const body = await parseJsonBody(c);
  const patch = parseInventoryPatch(body);
  if (!patch) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected valid item update fields.",
      },
      400,
    );
  }

  const updated = await updateInventoryItem(
    c.env.DB,
    auth.fridgeId,
    itemId,
    patch,
  );
  if (!updated) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }
  return c.json({ ok: true, item_id: itemId });
});

app.delete("/api/fridges/:fridgeId/inventory/:itemId", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const itemId = c.req.param("itemId") ?? "";
  if (!isValidFridgeId(itemId)) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }

  const deleted = await deleteInventoryItem(
    c.env.DB,
    c.env.PHOTOS,
    auth.fridgeId,
    itemId,
  );
  if (!deleted) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }
  return c.json({ ok: true, item_id: itemId, deleted: true });
});

app.get("/api/fridges/:fridgeId/inventory/:itemId/photo", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const itemId = c.req.param("itemId") ?? "";
  if (!isValidFridgeId(itemId)) {
    return c.json<ApiErrorEnvelope>(
      { error: "PHOTO_NOT_FOUND", message: "Photo not found." },
      404,
    );
  }

  const object = await readInventoryPhoto(
    c.env.DB,
    c.env.PHOTOS,
    auth.fridgeId,
    itemId,
  );
  if (!object) {
    return c.json<ApiErrorEnvelope>(
      { error: "PHOTO_NOT_FOUND", message: "Photo not found." },
      404,
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers });
});

app.get("/api/fridges/:fridgeId/telemetry", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const nowS = Math.floor(Date.now() / 1000);
  const samples = await queryTelemetryHistory(
    c.env.DB,
    auth.fridgeId,
    c.req.query("range"),
    nowS,
  );
  return c.json({ samples });
});

app.get("/api/fridges/:fridgeId/status", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const status = await getLatestStatus(c.env.DB, auth.fridgeId);
  return c.json({ status });
});

app.get("/api/fridges/:fridgeId/door_events", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const events = await listDoorEvents(
    c.env.DB,
    auth.fridgeId,
    c.req.query("limit"),
  );
  return c.json({ events });
});

app.all("/api/telemetry", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  const samples = parseTelemetry(body);
  if (!samples) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid telemetry batch.",
      },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const ingestedCount = await ingestTelemetry(c.env.DB, auth, samples, nowS);
  return c.json({ success: true, ingested_count: ingestedCount });
});

app.all("/api/status", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const receivedS = Math.floor(Date.now() / 1000);
  const body = await parseJsonBody(c);
  const report = parseStatus(body, receivedS);
  if (!report) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid node status report.",
      },
      400,
    );
  }

  const updatedCount = await ingestStatus(c.env.DB, auth, report, receivedS);
  return c.json({ success: true, updated_count: updatedCount });
});

app.all("/api/door_events", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  const events = parseDoorEvents(body);
  if (!events) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid door event batch.",
      },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const ingestedCount = await ingestDoorEvents(c.env.DB, auth, events, nowS);
  return c.json({ success: true, ingested_count: ingestedCount });
});

app.all("/api/*", (c) => {
  return c.json<ApiErrorEnvelope>(
    { error: "NOT_FOUND", message: "Unknown API route." },
    404,
  );
});

app.onError((_err, c) => {
  return c.json<ApiErrorEnvelope>(
    { error: "INTERNAL_ERROR", message: "The request could not be completed." },
    500,
  );
});

export default app;
