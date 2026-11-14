import { Hono } from "hono";
import type { ApiErrorEnvelope, AppBindings } from "./types";

export { FridgeRoom } from "./durable-objects/fridge-room";

export const app = new Hono<{ Bindings: AppBindings }>();

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
