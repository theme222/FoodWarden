import { listActivity } from "./lib/activity";
import {
  requireOperationId,
  runDraftOperation,
  OperationConflictError,
} from "./lib/operations";
import { HTTPException } from "hono/http-exception";
import { readLimitedBody } from "./lib/line-pairing";
import { lineRoutes } from "./line-routes";
import {
  personalDoorAlerts,
  personalTelemetryAlerts,
  queueMorningDigests,
  dispatchPersonalOutbox,
} from "./lib/personal-notifications";
import { dispatchLineOutbox } from "./lib/line";
import { InferenceQuotaError, withInferenceQuota } from "./lib/ai-quota";
import { SCALAR_ASSET_PATH } from "../scalar-assets";
import { Scalar } from "@scalar/hono-api-reference";
import { openApiDocument } from "./lib/openapi";
import { Hono, type Context } from "hono";
import {
  commitCameraCheckIn,
  listCheckOutCandidateRows,
  parseCheckInCommit,
  parseCheckOutCommit,
  parseMultipartJpeg,
  resolveCheckOutDraft,
  toPromptCandidates,
} from "./lib/ai-inventory";
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
  addDaysToIsoDate,
  bangkokIsoDate,
  classifyCheckInImage,
  GeminiUnavailableError,
  matchCheckOutImage,
  resolveFridgeGeminiKey,
} from "./lib/gemini";
import {
  addManualFood,
  CATEGORY_TH_MAP,
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
import {
  maybeSendDoorSafetyAlerts,
  maybeSendTelemetryAlerts,
  runDailyCronTasks,
} from "./lib/line";
import { notifyFridgeRoom } from "./lib/room";
import { ingestStatus, parseStatus } from "./lib/status";
import { putImmutablePhoto, toStoragePath } from "./lib/storage";
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
  const path = c.req.path;
  const limit =
    path === "/api/telemetry"
      ? 16 * 1024 * 1024
      : path === "/api/door_events"
        ? 2 * 1024 * 1024
        : path === "/api/status"
          ? 512 * 1024
          : c.req.method === "POST" &&
              /^\/api\/fridges\/[^/]+\/inventory$/.test(path)
            ? 2_000_000 + 64 * 1024
            : 64 * 1024;
  const bytes = await readLimitedBody(c.req.raw, limit);
  if (!bytes)
    throw new HTTPException(413, {
      message: "JSON body exceeds this endpoint's byte limit.",
    });
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return undefined;
  }
}
function ownerRevoked(c: Context<{ Bindings: AppBindings }>) {
  return c.json(
    { error: "FORBIDDEN", message: "Owner permission was revoked." },
    403,
  );
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
  const isUpgrade = c.req.header("Upgrade")?.toLowerCase() === "websocket";
  if (!isUpgrade) {
    c.header("Cache-Control", "private, no-store");
  }
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

app.get("/api/openapi.json", async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  return c.json(openApiDocument);
});

app.get(
  "/api/reference",
  async (c, next) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    return next();
  },
  Scalar((c) => {
    const nonce = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
    );
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; "),
    );
    return {
      nonce,
      url: "/api/openapi.json",
      pageTitle: "FoodWarden API Reference",
      theme: "purple",
      cdn: SCALAR_ASSET_PATH,
      proxyUrl: "",
      persistAuth: false,
      telemetry: false,
      withDefaultFonts: false,
    };
  }),
);
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

app.get("/api/ui/config", (c) => {
  c.header("Cache-Control", "private, no-store");
  const raw = c.env.UI_VERSION?.trim().toLowerCase();
  const defaultVersion = raw === "v1" ? "v1" : "v2";
  const locked = c.env.UI_VERSION_LOCK?.trim().toLowerCase() === "true";
  return c.json({ defaultVersion, locked });
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
  const created = await createFridge(c.env.DB, user.email, name, nowS, user.id);
  return c.json(created, 201);
});

app.get("/api/fridges/:fridgeId/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Expected WebSocket upgrade." },
      426,
    );
  }

  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;

  const id = c.env.FRIDGE_ROOM.idFromName(auth.fridgeId);
  const stub = c.env.FRIDGE_ROOM.get(id);
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-fw-user-email", auth.user.email);
  headers.set("x-fw-user-id", auth.user.id);
  headers.set("x-fw-session-id", auth.user.sessionId);
  headers.set("x-fw-fridge-id", auth.fridgeId);

  return stub.fetch(new Request(c.req.raw, { headers }));
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

  if (Object.hasOwn(body, "line_target_id")) {
    return c.json(
      {
        error: "INVALID_PAYLOAD",
        message:
          "Use verified LINE pairing or the dedicated disconnect endpoint.",
      },
      400,
    );
  }

  if (name === undefined) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "No editable fields provided." },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  if (
    !(await updateFridgeSettings(
      c.env.DB,
      auth.fridgeId,
      { name },
      nowS,
      auth.user.email,
    ))
  )
    return ownerRevoked(c);
  return c.json({ ok: true });
});

app.delete("/api/fridges/:fridgeId", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  if (
    !(await deleteFridge(
      c.env.DB,
      c.env.PHOTOS,
      auth.fridgeId,
      auth.user.email,
    ))
  )
    return ownerRevoked(c);
  await notifyFridgeRoom(c.env, auth.fridgeId, { type: "fridge_deleted" });
  return c.json({ ok: true, deleted: true });
});

app.get("/api/fridges/:fridgeId/settings", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const settings = await getFridgeSettings(
    c.env.DB,
    auth.fridgeId,
    auth.user.email,
  );
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

  if (Object.hasOwn(body, "line_target_id")) {
    return c.json(
      {
        error: "INVALID_PAYLOAD",
        message:
          "Use verified LINE pairing or the dedicated disconnect endpoint.",
      },
      400,
    );
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

  if (name === undefined && geminiApiKey === undefined) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "No settings fields provided." },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  if (
    !(await updateFridgeSettings(
      c.env.DB,
      auth.fridgeId,
      { name, gemini_api_key: geminiApiKey },
      nowS,
      auth.user.email,
    ))
  )
    return ownerRevoked(c);
  const updated = await getFridgeSettings(
    c.env.DB,
    auth.fridgeId,
    auth.user.email,
  );
  if (!updated) return ownerRevoked(c);
  return c.json(updated);
});

app.post("/api/fridges/:fridgeId/gateway-token/rotate", async (c) => {
  const auth = await requireFridgeRole(c, "owner");
  if (auth instanceof Response) return auth;

  const nowS = Math.floor(Date.now() / 1000);
  const gatewayToken = await rotateGatewayToken(
    c.env.DB,
    auth.fridgeId,
    nowS,
    auth.user.email,
  );
  if (!gatewayToken) return ownerRevoked(c);
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
    auth.user.email,
  );
  if (status === "forbidden")
    return c.json(
      { error: "FORBIDDEN", message: "Owner permission was revoked." },
      403,
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

  const outcome = await removeFridgeMember(
    c.env.DB,
    auth.fridgeId,
    email,
    auth.user.email,
  );
  if (outcome === "forbidden")
    return c.json(
      { error: "FORBIDDEN", message: "Owner permission was revoked." },
      403,
    );
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

  await notifyFridgeRoom(c.env, auth.fridgeId, {
    type: "member_revoked",
    email,
  });
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
  if (outcome === "created") {
    await notifyFridgeRoom(c.env, auth.fridgeId, {
      type: "inventory_changed",
      action: "created",
      itemId: food.itemId,
    });
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

  await notifyFridgeRoom(c.env, auth.fridgeId, {
    type: "inventory_changed",
    action: "updated",
    itemId,
  });
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
    "WEB_MANUAL",
  );
  if (!deleted) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }

  await notifyFridgeRoom(c.env, auth.fridgeId, {
    type: "inventory_changed",
    action: "deleted",
    itemId,
  });
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

app.get("/api/fridges/:fridgeId/activity", async (c) => {
  const auth = await requireFridgeRole(c, "any");
  if (auth instanceof Response) return auth;
  const page = await listActivity(
    c.env.DB, auth.fridgeId, c.req.query("kind") ?? "inventory",
    c.req.query("date"), c.req.query("before"),
  );
  if (!page) {
    return c.json<ApiErrorEnvelope>(
      { error: "INVALID_PAYLOAD", message: "Invalid activity filter." },
      400,
    );
  }
  c.header("Cache-Control", "private, no-store");
  return c.json(page);
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

app.all("/api/inventory/checkin/draft", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const operationId = requireOperationId(c.req.header("Idempotency-Key"));
  const parsed = await parseMultipartJpeg(c.req.raw);
  if (parsed.kind === "too_large") {
    return c.json<ApiErrorEnvelope>(
      {
        error: "PAYLOAD_TOO_LARGE",
        message: "Uploaded JPEG exceeds the 5 MB limit.",
      },
      413,
    );
  }
  if (parsed.kind === "invalid") {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected multipart/form-data with a valid JPEG image field.",
      },
      400,
    );
  }

  const apiKey = await resolveFridgeGeminiKey(c.env.DB, auth, c.env);
  if (!apiKey) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "SERVICE_UNAVAILABLE",
        message: "Gemini API key is not configured for this fridge.",
      },
      503,
    );
  }

  return runDraftOperation(
    c.env.DB,
    auth,
    "checkin",
    operationId,
    await sha256Hex(parsed.bytes),
    async () => {
      const nowS = Math.floor(Date.now() / 1000);
      let result;
      try {
        result = await withInferenceQuota(c.env, auth, () =>
          classifyCheckInImage(c.env, apiKey, parsed.bytes, nowS),
        );
      } catch (error) {
        if (error instanceof InferenceQuotaError) {
          c.header("Retry-After", "60");
          return c.json({ error: "RATE_LIMITED", message: error.message }, 429);
        }
        if (error instanceof GeminiUnavailableError) {
          return c.json<ApiErrorEnvelope>(
            { error: "SERVICE_UNAVAILABLE", message: error.message },
            503,
          );
        }
        throw error;
      }

      if (!result || !result.is_food || result.confidence < 0.6) {
        return c.json<ApiErrorEnvelope>(
          {
            error: "UNIDENTIFIABLE",
            message:
              "Item could not be reliably identified (confidence below 0.60 or non-food item).",
          },
          422,
        );
      }

      const cropKey = `food_crops/${auth}/crop_${crypto.randomUUID()}.jpg`;
      await putImmutablePhoto(c.env.PHOTOS, cropKey, parsed.bytes);

      const estimatedExpiryDate = addDaysToIsoDate(
        bangkokIsoDate(nowS),
        result.estimated_shelf_life_days,
      );

      return c.json({
        name_th: result.name_th,
        name_en: result.name_en,
        category: result.category,
        category_th: CATEGORY_TH_MAP[result.category],
        estimated_shelf_life_days: result.estimated_shelf_life_days,
        estimated_expiry_date: estimatedExpiryDate,
        storage_recommendation_th: result.storage_recommendation_th,
        storage_recommendation_en: result.storage_recommendation_en,
        image_storage_path: toStoragePath(cropKey),
        confidence: result.confidence,
      });
    },
  );
});

app.all("/api/inventory/checkin", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const operationId = requireOperationId(c.req.header("Idempotency-Key"));
  const body = await parseJsonBody(c);
  const payload = parseCheckInCommit(body, auth);
  if (!payload) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid check-in commit payload.",
      },
      400,
    );
  }

  const nowS = Math.floor(Date.now() / 1000);
  const itemId = await commitCameraCheckIn(
    c.env.DB,
    auth,
    payload,
    nowS,
    operationId,
  );
  await notifyFridgeRoom(c.env, auth, {
    type: "inventory_changed",
    action: "created",
    itemId,
  });

  return c.json(
    {
      success: true,
      item_id: itemId,
      message: "Item successfully added to inventory.",
    },
    201,
  );
});

app.all("/api/inventory/checkout/draft", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const operationId = requireOperationId(c.req.header("Idempotency-Key"));
  const parsed = await parseMultipartJpeg(c.req.raw);
  if (parsed.kind === "too_large") {
    return c.json<ApiErrorEnvelope>(
      {
        error: "PAYLOAD_TOO_LARGE",
        message: "Uploaded JPEG exceeds the 5 MB limit.",
      },
      413,
    );
  }
  if (parsed.kind === "invalid") {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected multipart/form-data with a valid JPEG image field.",
      },
      400,
    );
  }

  const apiKey = await resolveFridgeGeminiKey(c.env.DB, auth, c.env);
  if (!apiKey) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "SERVICE_UNAVAILABLE",
        message: "Gemini API key is not configured for this fridge.",
      },
      503,
    );
  }

  return runDraftOperation(
    c.env.DB,
    auth,
    "checkout",
    operationId,
    await sha256Hex(parsed.bytes),
    async () => {
      const rows = await listCheckOutCandidateRows(c.env.DB, auth);
      let result;
      try {
        result = await withInferenceQuota(c.env, auth, () =>
          matchCheckOutImage(
            c.env,
            apiKey,
            parsed.bytes,
            toPromptCandidates(rows),
          ),
        );
      } catch (error) {
        if (error instanceof InferenceQuotaError) {
          c.header("Retry-After", "60");
          return c.json({ error: "RATE_LIMITED", message: error.message }, 429);
        }
        if (error instanceof GeminiUnavailableError) {
          return c.json<ApiErrorEnvelope>(
            { error: "SERVICE_UNAVAILABLE", message: error.message },
            503,
          );
        }
        throw error;
      }

      if (!result || result.confidence < 0.6) {
        return c.json<ApiErrorEnvelope>(
          {
            error: "UNIDENTIFIABLE",
            message:
              "Removed item could not be reliably identified (confidence below 0.60).",
          },
          422,
        );
      }

      return c.json(resolveCheckOutDraft(rows, result));
    },
  );
});

app.all("/api/inventory/checkout", async (c) => {
  const auth = await requireGatewayFridge(c);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody(c);
  const payload = parseCheckOutCommit(body);
  if (!payload) {
    return c.json<ApiErrorEnvelope>(
      {
        error: "INVALID_PAYLOAD",
        message: "Expected a valid item_id to check out.",
      },
      400,
    );
  }

  const deleted = await deleteInventoryItem(
    c.env.DB,
    c.env.PHOTOS,
    auth,
    payload.item_id,
    "CAMERA",
  );
  if (!deleted) {
    return c.json<ApiErrorEnvelope>(
      { error: "NOT_FOUND", message: "Item not found." },
      404,
    );
  }

  await notifyFridgeRoom(c.env, auth, {
    type: "inventory_changed",
    action: "deleted",
    itemId: payload.item_id,
  });

  return c.json({
    success: true,
    item_id: payload.item_id,
    status: "deleted",
    message: "Item and associated image permanently removed from inventory.",
  });
});

async function clearFridgeAlertCooldowns(
  db: D1Database,
  fridgeId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM alert_cooldowns WHERE fridge_id = ?")
      .bind(fridgeId),
    db
      .prepare("DELETE FROM user_alert_cooldowns WHERE fridge_id = ?")
      .bind(fridgeId),
    db
      .prepare("DELETE FROM line_alert_events WHERE fridge_id = ?")
      .bind(fridgeId),
    db
      .prepare("DELETE FROM user_line_events WHERE fridge_id = ?")
      .bind(fridgeId),
  ]);
}

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
  const bypassCooldown = c.req.query("bypass_cooldown") === "1";
  const ingestedCount = await ingestTelemetry(c.env.DB, auth, samples, nowS);
  if (ingestedCount > 0) {
    await Promise.all([
      notifyFridgeRoom(c.env, auth, {
        type: "telemetry",
        samples,
        last_seen_s: nowS,
      }),
    ]);
  }
  if (bypassCooldown) await clearFridgeAlertCooldowns(c.env.DB, auth);
  await Promise.all([
    maybeSendTelemetryAlerts(c.env, auth, samples, nowS),
    personalTelemetryAlerts(c.env, auth, samples, nowS),
  ]);
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

  const { updatedCount, status } = await ingestStatus(
    c.env.DB,
    auth,
    report,
    receivedS,
  );
  if (updatedCount > 0 && status) {
    await notifyFridgeRoom(c.env, auth, {
      type: "status",
      status,
    });
  }
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
  const bypassCooldown = c.req.query("bypass_cooldown") === "1";
  const ingestedCount = await ingestDoorEvents(c.env.DB, auth, events, nowS);
  if (ingestedCount > 0) {
    await Promise.all([
      notifyFridgeRoom(c.env, auth, {
        type: "door_events",
        events,
      }),
    ]);
  }
  if (bypassCooldown) await clearFridgeAlertCooldowns(c.env.DB, auth);
  await Promise.all([
    maybeSendDoorSafetyAlerts(c.env, auth, events, nowS),
    personalDoorAlerts(c.env, auth, events, nowS),
  ]);
  return c.json({ success: true, ingested_count: ingestedCount });
});

app.route("/api", lineRoutes);

app.all("/api/*", (c) => {
  return c.json<ApiErrorEnvelope>(
    { error: "NOT_FOUND", message: "Unknown API route." },
    404,
  );
});

app.onError((_err, c) => {
  if (
    _err instanceof HTTPException &&
    (_err.status === 413 || _err.status === 400)
  )
    return c.json(
      {
        error: _err.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_PAYLOAD",
        message: _err.message,
      },
      _err.status,
    );
  if (_err instanceof OperationConflictError)
    return c.json({ error: "CONFLICT", message: _err.message }, 409);
  if (_err.message.includes("PHOTO_RETIRED"))
    return c.json(
      {
        error: "CONFLICT",
        message: "This photo has expired. Upload a new image.",
      },
      409,
    );
  return c.json<ApiErrorEnvelope>(
    { error: "INTERNAL_ERROR", message: "The request could not be completed." },
    500,
  );
});

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      controller.cron === "* * * * *"
        ? (async () => {
            const nowS = Math.floor(controller.scheduledTime / 1000);
            await queueMorningDigests(env, nowS);
            await Promise.all([
              dispatchLineOutbox(env, nowS),
              dispatchPersonalOutbox(env, nowS),
            ]);
          })()
        : runDailyCronTasks(env, Math.floor(controller.scheduledTime / 1000)),
    );
  },
} satisfies ExportedHandler<AppBindings>;
