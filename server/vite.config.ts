import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { SCALAR_ASSET_PATH, SCALAR_VERSION } from "./scalar-assets";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function scalarAssets(): Plugin {
  const packageRoot = fileURLToPath(
    new URL("./node_modules/@scalar/api-reference/", import.meta.url),
  );
  const pkg = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  if (pkg.version !== SCALAR_VERSION)
    throw new Error(
      "Update SCALAR_VERSION to match the installed Scalar package.",
    );
  const source = readFileSync(
    path.join(packageRoot, "dist/browser/standalone.js"),
  );
  return {
    name: "foodwarden-scalar-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== SCALAR_ASSET_PATH) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(source);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: SCALAR_ASSET_PATH.slice(1),
        source,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_WORKER_URL || "http://127.0.0.1:8787";

  return {
    plugins: [react(), tailwindcss(), scalarAssets()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
