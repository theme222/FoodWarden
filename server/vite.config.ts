import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const projectId = env.VITE_FIREBASE_PROJECT_ID || "demo-foodwarden";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:" + (env.VITE_EMULATOR_FUNCTIONS_PORT || "5001"),
          rewrite: (path) => "/" + projectId + "/asia-southeast1" + path,
        },
      },
    },
  };
});
