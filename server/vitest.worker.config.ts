import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.resolve(import.meta.dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: "development",
            LINE_CHANNEL_ACCESS_TOKEN: "test-line-channel-token",
            DEV_AUTH_BYPASS_EMAIL: "",
            GOOGLE_CLIENT_ID: "",
            GOOGLE_CLIENT_SECRET: "",
            BETTER_AUTH_URL: "",
          },
        },
      }),
    ],
    test: {
      include: ["workers/**/*.test.ts"],
    },
  };
});
