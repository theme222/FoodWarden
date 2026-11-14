import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "./index";
import {
  createAuth,
  isDevBypassEnabled,
  createSignedSessionForEmail,
} from "./lib/auth";
import type { AppBindings } from "./types";

const bindings = env as unknown as AppBindings;
describe("production authentication defaults", () => {
  beforeAll(async () => {
    const testBindings = env as unknown as AppBindings & {
      TEST_MIGRATIONS: D1Migration[];
    };
    await applyD1Migrations(testBindings.DB, testBindings.TEST_MIGRATIONS);
  });
  it("fails closed for production, missing and unknown environments even when a dev email exists", async () => {
    for (const APP_ENV of ["production", "", "staging"]) {
      const production = {
        ...bindings,
        APP_ENV,
        DEV_AUTH_BYPASS_EMAIL: "dev@example.com",
        BETTER_AUTH_URL: "https://foodwarden.example",
        BETTER_AUTH_SECRET:
          "test-only-production-secret-at-least-32-characters",
      };
      expect(isDevBypassEnabled(production)).toBe(false);
      const result = await app.request(
        "https://foodwarden.example/api/auth/dev-login",
        { method: "POST" },
        production,
      );
      expect(result.status).toBe(404);
      const auth = createAuth(production, "https://foodwarden.example");
      expect(auth.options.trustedOrigins).toEqual([
        "https://foodwarden.example",
      ]);
      const signed = await createSignedSessionForEmail(
        production,
        "https://foodwarden.example",
        { email: `production-${crypto.randomUUID()}@example.com` },
      );
      const cookie = signed.cookieHeader.split(";")[0]!;
      const signout = await auth.handler(
        new Request("https://foodwarden.example/api/auth/sign-out", {
          method: "POST",
          headers: {
            Origin: "http://localhost:5173",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(signout.status).toBe(403);
      const legitimate = await auth.handler(
        new Request("https://foodwarden.example/api/auth/sign-out", {
          method: "POST",
          headers: {
            Origin: "https://foodwarden.example",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(legitimate.status).toBe(200);
      expect(() =>
        createAuth(
          { ...production, BETTER_AUTH_SECRET: "" },
          "https://foodwarden.example",
        ),
      ).toThrow("BETTER_AUTH_SECRET must be configured outside development");
    }
  });
  it("retains explicit local development behavior", () => {
    const local = {
      ...bindings,
      APP_ENV: "development",
      DEV_AUTH_BYPASS_EMAIL: "dev@example.com",
      BETTER_AUTH_SECRET: "",
    };
    expect(isDevBypassEnabled(local)).toBe(true);
    expect(
      createAuth(local, "http://localhost:8787").options.trustedOrigins,
    ).toContain("http://localhost:5173");
  });
});
