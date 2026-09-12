import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "mpa",
  plugins: [react()],
  resolve: {
    alias: {
      "@karaoke/shared": path.resolve(root, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
