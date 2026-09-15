import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const SERVER_ORIGIN = process.env.KARAOKE_SERVER_ORIGIN || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  // Repo-root `.env` (see `.env.example`) so VITE_PUBLIC_POSTHOG_KEY is visible.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    alias: {
      "@karaoke/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    proxy: {
      "/api": SERVER_ORIGIN,
      "/socket.io": { target: SERVER_ORIGIN, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
