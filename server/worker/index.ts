import { Hono, type Context } from "hono";
import { ingestDoorEvents, parseDoorEvents } from "./lib/door-events";
import {
  extractBearerToken,
  findGatewayFridgeId,
  sha256Hex,
} from "./lib/gateway";
import { ingestStatus, parseStatus } from "./lib/status";
import { ingestTelemetry, parseTelemetry } from "./lib/telemetry";
import type { ApiErrorEnvelope, AppBindings } from "./types";

export { FridgeRoom } from "./durable-objects/fridge-room";

export const app = new Hono<{ Bindings: AppBindings }>();

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
