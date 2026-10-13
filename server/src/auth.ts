/**
 * Supabase Auth on the server: turn a browser's access token into a trusted
 * player id (the Supabase user id), so the client-sent `clientId` is no longer
 * taken on faith.
 *
 * Verification calls Supabase's `GET /auth/v1/user` with the public anon /
 * publishable key. That works for both legacy HS256 projects and the newer
 * asymmetric signing keys, and needs no secret on this box.
 *
 * Enforcement is on whenever SUPABASE_URL + SUPABASE_ANON_KEY (or the VITE_
 * twins the web build uses) are visible here. Set REQUIRE_SUPABASE_AUTH=0 to
 * fall back to the old trust-the-client behaviour (local hacking only).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import type { Express, Request, Response } from "express";
import type { Server, Socket } from "socket.io";

import { getDb, players } from "./db.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Only the Supabase keys from the repo-root env files, nothing else. */
function rootEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    const p = path.resolve(here, "../..", file);
    if (!existsSync(p)) continue;
    try {
      const parsed = dotenv.parse(readFileSync(p));
      for (const [k, v] of Object.entries(parsed)) {
        if (k.includes("SUPABASE") && v.trim()) out[k] = v.trim();
      }
    } catch {
      /* unreadable env file: ignore */
    }
  }
  return out;
}

let cachedConfig: { url: string; key: string } | null | undefined;

function config(): { url: string; key: string } | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const file = rootEnv();
  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = process.env[n]?.trim() || file[n];
      if (v) return v;
    }
    return "";
  };
  const url = pick("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/+$/, "");
  const key = pick("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
  cachedConfig = url && key ? { url, key } : null;
  return cachedConfig;
}

/** True when the server can verify tokens and will require them to play. */
export function authRequired(): boolean {
  if (process.env.REQUIRE_SUPABASE_AUTH?.trim() === "0") return false;
  return config() !== null;
}

type Verified = { userId: string; expiresAtMs: number };
const verified = new Map<string, Verified>();
const CACHE_MS = 5 * 60_000;

function jwtExpMs(token: string): number {
  try {
    const body = token.split(".")[1] ?? "";
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Supabase user id for a valid access token, else null. */
export async function verifyAccessToken(token: unknown): Promise<string | null> {
  const cfg = config();
  if (!cfg || typeof token !== "string" || !token || token.length > 8192) return null;

  const now = Date.now();
  const hit = verified.get(token);
  if (hit && hit.expiresAtMs > now) return hit.userId;
  if (hit) verified.delete(token);

  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: unknown };
    if (typeof user.id !== "string" || !user.id) return null;
    const exp = jwtExpMs(token) || now + CACHE_MS;
    if (verified.size > 5000) verified.clear();
    verified.set(token, { userId: user.id, expiresAtMs: Math.min(exp, now + CACHE_MS) });
    return user.id;
  } catch {
    return null;
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export type HttpIdentity =
  | { ok: true; clientId: string }
  | { ok: false; status: number; message: string };

/**
 * The player id an HTTP request may act as. With auth on, that is the token's
 * user id and `claimed` must match it (or be absent). With auth off, it is
 * whatever the client claimed, as before.
 */
export async function httpIdentity(req: Request, claimed: unknown): Promise<HttpIdentity> {
  const claim = typeof claimed === "string" ? claimed : "";
  if (!authRequired()) {
    return claim
      ? { ok: true, clientId: claim }
      : { ok: false, status: 400, message: "clientId required" };
  }
  const userId = await verifyAccessToken(bearer(req));
  if (!userId) return { ok: false, status: 401, message: "sign in to play" };
  if (claim && claim !== userId) return { ok: false, status: 403, message: "not your player" };
  return { ok: true, clientId: userId };
}

/** Verify the handshake token once per connection; never rejects the socket. */
export function attachSocketAuth(io: Server): void {
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    void verifyAccessToken(token)
      .then((userId) => {
        socket.data.authUserId = userId;
      })
      .catch(() => {
        socket.data.authUserId = null;
      })
      .finally(() => next());
  });
}

/**
 * The player id a socket may use. With auth on, the verified user id (or null
 * when the socket is signed out). With auth off, the client's claim.
 */
export function socketIdentity(socket: Socket, claimed: unknown): string | null {
  if (!authRequired()) return typeof claimed === "string" && claimed ? claimed : null;
  const id = socket.data.authUserId;
  return typeof id === "string" && id ? id : null;
}

/**
 * POST /api/player/link — carry a pre-account rating over to the signed-in
 * account. `legacyClientId` is the random localStorage id this browser played
 * under as a guest (PR #5), or an older Supabase user id (PR #3).
 *
 * Rules: one claim per legacy id (it is marked `linkedTo`), and only into an
 * account that has not played a ranked match yet, so nobody's rating is
 * overwritten or double counted.
 */
export function registerAuthRoutes(app: Express): void {
  app.post("/api/player/link", async (req: Request, res: Response) => {
    if (!authRequired()) {
      res.status(501).json({ ok: false, error: "auth not configured on server" });
      return;
    }
    const userId = await verifyAccessToken(bearer(req));
    if (!userId) {
      res.status(401).json({ ok: false, error: "sign in first" });
      return;
    }
    const legacy = typeof req.body?.legacyClientId === "string" ? req.body.legacyClientId.trim() : "";
    if (!legacy || legacy === userId || legacy.length > 128) {
      res.json({ ok: true, linked: false });
      return;
    }
    const db = await getDb();
    if (!db) {
      res.json({ ok: true, linked: false, mongo: false });
      return;
    }
    const account = await players(db).findOne({ clientId: userId });
    if (account && account.matchesPlayed > 0) {
      res.json({ ok: true, linked: false, reason: "account already has matches" });
      return;
    }
    const claimed = await players(db).findOneAndUpdate(
      { clientId: legacy, linkedTo: { $exists: false } },
      { $set: { linkedTo: userId, updatedAt: new Date() } },
      { returnDocument: "before" },
    );
    if (!claimed) {
      res.json({ ok: true, linked: false });
      return;
    }
    await players(db).updateOne(
      { clientId: userId },
      {
        $set: {
          elo: claimed.elo,
          matchesPlayed: claimed.matchesPlayed,
          updatedAt: new Date(),
          linkedFrom: legacy,
        },
        $setOnInsert: { clientId: userId, displayName: claimed.displayName },
      },
      { upsert: true },
    );
    res.json({ ok: true, linked: true, elo: claimed.elo });
  });
}
