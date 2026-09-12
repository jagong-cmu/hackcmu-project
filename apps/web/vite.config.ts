import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const SERVER_ORIGIN = "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Workspace package is raw TypeScript; point Vite at the source so it
      // gets transpiled instead of treated as a prebundled dependency.
      "@karaoke/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": SERVER_ORIGIN,
      "/socket.io": { target: SERVER_ORIGIN, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
