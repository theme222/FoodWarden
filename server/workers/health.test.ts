import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
}

const EXPECTED_TABLES = [
  "inventory_operations",
  "draft_operations",
  "line_pairing_codes",
  "line_webhook_attempts",
  "line_target_resets",
  "user_line_profiles",
  "user_fridge_favorites",
  "user_fridge_fav_categories",
  "user_alert_cooldowns",
  "user_line_events",
  "user_line_outbox",
  "account",
  "ai_reservations",
  "alert_cooldowns",
  "door_events",
  "fridge_members",
  "fridge_secrets",
  "fridges",
  "inventory",
  "line_alert_events",
  "line_outbox",
  "photo_gc_claims",
  "session",
  "system_status",
  "telemetry_samples",
  "user",
  "verification",
];

describe("worker scaffold and D1 schema", () => {
  beforeAll(async () => {
    const testEnv = env as unknown as TestEnv;
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  it("creates all required FoodWarden and Better Auth tables in D1", async () => {
    const testEnv = env as unknown as TestEnv;
    const { results } = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name ASC",
    ).all<{ name: string }>();

    const tableNames = results.map((row) => row.name);
    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });

  it("returns 200 ok from GET /api/health", async () => {
    const response = await exports.default.fetch("http://localhost/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, database: "ok" });
  });

  it("returns JSON 404 envelope for unknown /api/* routes", async () => {
    const response = await exports.default.fetch(
      "http://localhost/api/does-not-exist",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "NOT_FOUND",
      message: "Unknown API route.",
    });
  });
});
