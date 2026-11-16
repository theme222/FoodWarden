import { SCALAR_ASSET_PATH } from "../scalar-assets";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { OpenAPIV3_1 } from "openapi-types";
import { app } from "./index";
import { createSignedSessionForEmail } from "./lib/auth";
import type { AppBindings } from "./types";

interface TestEnv extends AppBindings {
  TEST_MIGRATIONS: D1Migration[];
}
const testEnv = env as unknown as TestEnv;
const docsPaths = ["/api/reference", "/api/openapi.json"];
async function sessionCookie(
  options: { emailVerified?: boolean; expiresInMs?: number } = {},
): Promise<string> {
  const { cookieHeader } = await createSignedSessionForEmail(
    testEnv,
    "http://localhost/",
    {
      email: `docs-${crypto.randomUUID()}@example.com`,
      ...options,
    },
  );
  return cookieHeader.split(";")[0]!;
}

describe("authenticated Scalar reference and OpenAPI document", () => {
  beforeAll(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  });

  it("rejects anonymous, unverified and expired sessions on both documentation routes", async () => {
    const cookies = [
      undefined,
      await sessionCookie({ emailVerified: false }),
      await sessionCookie({ expiresInMs: -60_000 }),
    ];
    for (const cookie of cookies) {
      for (const path of docsPaths) {
        const response = await exports.default.fetch(
          `http://localhost${path}`,
          {
            headers: cookie ? { Cookie: cookie } : {},
          },
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }
  });

  it("serves Scalar HTML without embedding credentials or enabling a third-party request proxy", async () => {
    const cookie = await sessionCookie();
    const response = await exports.default.fetch(
      "http://localhost/api/reference",
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const html = await response.text();
    expect(html).toContain("FoodWarden API Reference");
    expect(html).toContain("/api/openapi.json");
    expect(html).toContain(`src="${SCALAR_ASSET_PATH}"`);
    expect(html).not.toContain("cdn.jsdelivr.net");
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(
      html
        .match(/<script[^>]*>/g)
        ?.every((tag) => tag.includes(`nonce="${nonce}"`)),
    ).toBe(true);
    const second = await exports.default.fetch(
      "http://localhost/api/reference",
      { headers: { Cookie: cookie } },
    );
    expect(second.headers.get("Content-Security-Policy")).not.toBe(policy);
    expect(html).toMatch(/"persistAuth":\s*false/);
    expect(html).toMatch(/"proxyUrl":\s*""/);
    expect(html).toMatch(/"telemetry":\s*false/);
    expect(html).not.toContain(cookie);
    expect(html).not.toContain("proxy.scalar.com");
  });

  it("documents every explicit application route and distinguishes sessions from gateway Bearer auth", async () => {
    const cookie = await sessionCookie();
    const response = await exports.default.fetch(
      "http://localhost/api/openapi.json",
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const document = await response.json<OpenAPIV3_1.Document>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      { url: "/", description: "Current FoodWarden origin" },
    ]);
    const actualRoutes = new Set(
      app.routes
        .filter(
          ({ path }) =>
            path.startsWith("/api/") &&
            !path.includes("*") &&
            !docsPaths.includes(path),
        )
        .map(
          ({ path, method }) =>
            `${method === "ALL" ? "POST" : method} ${path.replace(/:([^/]+)/g, "{$1}")}`,
        ),
    );
    const documentedRoutes = new Set<string>();
    const operations = ["get", "post", "put", "patch", "delete"] as const;
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of operations) {
        if (item?.[method])
          documentedRoutes.add(`${method.toUpperCase()} ${path}`);
      }
    }
    expect([...documentedRoutes].sort()).toEqual([...actualRoutes].sort());
    expect(document.paths?.["/api/telemetry"]?.post?.security).toEqual([
      { GatewayBearer: [] },
    ]);
    expect(document.paths?.["/api/fridges"]?.get?.security).toEqual([
      { BrowserSession: [] },
      { SecureBrowserSession: [] },
    ]);
    expect(document.paths?.["/api/health"]?.get?.security).toEqual([]);
    expect(
      document.paths?.["/api/fridges/{fridgeId}/ws"]?.get?.responses,
    ).toHaveProperty("101");
    expect(JSON.stringify(document)).not.toContain(cookie);
  });
});
