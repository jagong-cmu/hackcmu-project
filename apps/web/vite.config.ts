import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { legalDocs } from "./src/legal/content.ts";
import { legalStaticHtml } from "./src/legal/render.ts";

const SERVER_ORIGIN = process.env.KARAOKE_SERVER_ORIGIN || "http://127.0.0.1:8080";

/**
 * Writes dist/privacy/index.html and dist/terms/index.html: the built
 * index.html with the policy text already inside #root (plus its own title,
 * description and canonical). Crawlers and Google's OAuth reviewers get the
 * full text without JavaScript; browsers boot the SPA from it as usual and
 * React re-renders the same text. vercel.json rewrites /privacy and /terms to
 * these files ahead of the SPA catch-all.
 */
function legalPages(): Plugin {
  let outDir = "";
  return {
    name: "aria-legal-pages",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = readFileSync(path.join(outDir, "index.html"), "utf8");
      for (const doc of legalDocs) {
        const dir = path.join(outDir, doc.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "index.html"), legalStaticHtml(index, doc));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), legalPages()],
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
