/**
 * Supabase Auth on the server: turn a browser's access token into a trusted
 * player id (the Supabase user id). There is no guest play: every play path
 * (socket hello and everything seated behind it, score posts, LiveKit tokens,
 * room snapshots, training scores) needs a verified account.
 *
 * Verification calls Supabase's `GET /auth/v1/user` with the public anon /
 * publishable key. That works for both legacy HS256 projects and the newer
 * asymmetric signing keys, and needs no secret on this box.
 *
 * Fails closed. Modes (see resolveAuthMode):
 * - "verify": SUPABASE_URL + SUPABASE_ANON_KEY (or their VITE_ twins) are
 *   visible. Every play path needs a valid access token.
 * - "unconfigured": no Supabase config. Play is refused outright (503), never
 *   downgraded to trusting the client.
 * - "dev-guest": local development only. AUTH_REQUIRED=0 (or
 *   VITE_AUTH_REQUIRED=0, so one line in the root .env.local covers both the
 *   web build and this server) restores the old trust-the-clientId guest mode
 *   so one developer can play both seats. Ignored when NODE_ENV=production or
 *   on Vercel / Render, so production cannot switch accounts off via env.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import type { Request } from "express";
import type { Server, Socket } from "socket.io";


const here = path.dirname(fileURLToPath(import.meta.url));

/** Only the Supabase keys (and the dev auth opt-out) from the repo-root env files. */
function rootEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    const p = path.resolve(here, "../..", file);
    if (!existsSync(p)) continue;
    try {
      const parsed = dotenv.parse(readFileSync(p));
      for (const [k, v] of Object.entries(parsed)) {
        if ((k.includes("SUPABASE") || k.endsWith("AUTH_REQUIRED")) && v.trim()) out[k] = v.trim();
      }
    } catch {
      /* unreadable env file: ignore */
    }
  }
  return out;
}

type SupabaseConfig = { url: string; key: string };
let cachedConfig: SupabaseConfig | null | undefined;
let cachedFile: Record<string, string> | undefined;

function fileEnv(): Record<string, string> {
  if (!cachedFile) cachedFile = rootEnv();
  return cachedFile;
}

function config(): SupabaseConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const file = fileEnv();
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

/** Test-only: pin the Supabase config (null = none), or `undefined` to re-read env. */
export function setAuthConfigForTests(cfg: SupabaseConfig | null | undefined): void {
  cachedConfig = cfg;
  cachedFile = cfg === undefined ? undefined : {};
  verified.clear();
  rejected.clear();
}

export type AuthMode = "verify" | "dev-guest" | "unconfigured";
type Env = Record<string, string | undefined>;

/**
 * May this process honour the dev opt-out at all? Never in production: not
 * when NODE_ENV=production, and not on the hosts we deploy to (Vercel sets
 * VERCEL, Render sets RENDER), whatever NODE_ENV says there.
 */
export function devOptOutAllowed(env: Env): boolean {
  if (env.NODE_ENV?.trim() === "production") return false;
  if (env.VERCEL?.trim() || env.RENDER?.trim()) return false;
  return true;
}

/** Pure: which auth mode an environment ends up in. */
export function resolveAuthMode(env: Env, hasConfig: boolean): AuthMode {
  const flag = (env.AUTH_REQUIRED ?? env.VITE_AUTH_REQUIRED)?.trim();
  if (flag === "0" && devOptOutAllowed(env)) return "dev-guest";
  return hasConfig ? "verify" : "unconfigured";
}

export function authMode(): AuthMode {
  const file = fileEnv();
  // Process env wins over the root env files; the opt-out flag may live in either.
  const env: Env = {
    ...process.env,
    AUTH_REQUIRED:
      process.env.AUTH_REQUIRED ??
      process.env.VITE_AUTH_REQUIRED ??
      file.AUTH_REQUIRED ??
      file.VITE_AUTH_REQUIRED,
  };
  return resolveAuthMode(env, config() !== null);
}

/** True unless this is the local dev opt-out: play needs a verified account. */
export function authRequired(): boolean {
  return authMode() !== "dev-guest";
}

const UNCONFIGURED_MESSAGE = "Accounts aren't configured on this server, so play is off.";

type Verified = { userId: string; expiresAtMs: number; tokenExpMs: number };
const verified = new Map<string, Verified>();
const CACHE_MS = 5 * 60_000;
const VERIFIED_MAX = 5000;

/**
 * Tokens Supabase rejected (4xx), keyed by a hash of the token, so a client
 * that keeps sending the same garbage costs one Supabase call a minute, not
 * two per attempt. Network errors and 5xx are never cached: those are retried.
 */
const rejected = new Map<string, number>();
export const RejectedTokenCacheMs = 60_000;
export const RejectedTokenCacheMax = 5000;

/** Clock skew we forgive when reading a token's own `exp` before asking Supabase. */
const EXP_SKEW_MS = 60_000;

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function rememberRejected(key: string, now: number): void {
  rejected.delete(key);
  rejected.set(key, now + RejectedTokenCacheMs);
  // A Map iterates in insertion order: drop the oldest entries past the cap.
  while (rejected.size > RejectedTokenCacheMax) {
    const oldest = rejected.keys().next().value;
    if (oldest === undefined) break;
    rejected.delete(oldest);
  }
}

function recentlyRejected(key: string, now: number): boolean {
  const until = rejected.get(key);
  if (until === undefined) return false;
  if (until > now) return true;
  rejected.delete(key);
  return false;
}

/** Test-only: how many rejected tokens are remembered. */
export function rejectedTokenCacheSize(): number {
  return rejected.size;
}

function jwtExpMs(token: string): number {
  try {
    const body = token.split(".")[1] ?? "";
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Cheap local screen before any network call. Supabase access tokens are
 * always three-part JWTs with an `exp`; anything else, or one that expired
 * more than a minute ago, cannot verify, so Supabase is never asked. This
 * reads the claims without checking the signature, so it can only say no.
 */
function plausibleToken(token: string, now: number): boolean {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token)) return false;
  const exp = jwtExpMs(token);
  return exp > 0 && exp + EXP_SKEW_MS > now;
}

export type VerifiedToken = { userId: string; expMs: number };

/**
 * Supabase user id and token expiry for a valid access token, else null.
 * Tokens Supabase rejected are remembered for a minute (see `rejected`).
 */
export async function verifyAccessTokenDetailed(token: unknown): Promise<VerifiedToken | null> {
  const cfg = config();
  if (!cfg || typeof token !== "string" || !token || token.length > 8192) return null;

  const now = Date.now();
  const hit = verified.get(token);
  if (hit && hit.expiresAtMs > now) return { userId: hit.userId, expMs: hit.tokenExpMs };
  if (hit) verified.delete(token);

  if (!plausibleToken(token, now)) return null;
  const key = tokenKey(token);
  if (recentlyRejected(key, now)) return null;

  // One retry on a network error or a 5xx: a cold start or a blip at Supabase
  // must not leave a signed-in player stuck on "Sign in to play". A 4xx means
  // the token itself is bad, so that is final (and cached for a minute).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${cfg.url}/auth/v1/user`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.status >= 500) continue;
      if (!res.ok) {
        if (res.status >= 400) rememberRejected(key, Date.now());
        return null;
      }
      const user = (await res.json()) as { id?: unknown };
      if (typeof user.id !== "string" || !user.id) return null;
      const exp = jwtExpMs(token);
      if (verified.size > VERIFIED_MAX) verified.clear();
      verified.set(token, { userId: user.id, expiresAtMs: Math.min(exp, now + CACHE_MS), tokenExpMs: exp });
      return { userId: user.id, expMs: exp };
    } catch {
      // network error or timeout: retry once
    }
  }
  return null;
}

/** Supabase user id for a valid access token, else null. */
export async function verifyAccessToken(token: unknown): Promise<string | null> {
  return (await verifyAccessTokenDetailed(token))?.userId ?? null;
}

/** How long past its token's `exp` a socket stays authorised before it must re-verify. */
export const SocketAuthGraceMs = 30_000;

/**
 * Has this socket's verified token run out (plus grace)? Sockets in the dev
 * opt-out, or never verified, carry no expiry and are never "expired".
 */
export function socketAuthExpired(socket: Pick<Socket, "data">, now = Date.now()): boolean {
  const exp: unknown = socket.data?.authExpMs;
  if (!socket.data?.authUserId || typeof exp !== "number" || exp <= 0) return false;
  return now > exp + SocketAuthGraceMs;
}

/** Forget a socket's verified identity: it gets AUTH_REQUIRED until it re-verifies. */
export function clearSocketAuth(socket: Pick<Socket, "data">): void {
  socket.data.authUserId = null;
  socket.data.authExpMs = 0;
}

/**
 * Re-verify a socket from a token sent with player:hello. The handshake token
 * can be missing (the page raced its session restore) or expired (a long-lived
 * tab); this lets the client heal the socket without reconnecting.
 */
export async function refreshSocketAuth(socket: Pick<Socket, "data">, token: unknown): Promise<void> {
  if (authMode() !== "verify" || typeof token !== "string" || !token) return;
  const ok = await verifyAccessTokenDetailed(token);
  if (ok) {
    socket.data.authUserId = ok.userId;
    socket.data.authExpMs = ok.expMs;
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
  | { ok: false; status: number; code: string; message: string };

/**
 * The player id an HTTP request may act as: the token's user id, with
 * `claimed` required to match it (or be absent). Only in the dev opt-out is it
 * whatever the client claimed. No Supabase config means no play at all.
 */
export async function httpIdentity(req: Request, claimed: unknown): Promise<HttpIdentity> {
  const claim = typeof claimed === "string" ? claimed : "";
  const mode = authMode();
  if (mode === "dev-guest") {
    return claim
      ? { ok: true, clientId: claim }
      : { ok: false, status: 400, code: "BAD_REQUEST", message: "clientId required" };
  }
  if (mode === "unconfigured") {
    return { ok: false, status: 503, code: "AUTH_UNCONFIGURED", message: UNCONFIGURED_MESSAGE };
  }
  const userId = await verifyAccessToken(bearer(req));
  if (!userId) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "sign in to play" };
  if (claim && claim !== userId) {
    return { ok: false, status: 403, code: "IDENTITY_MISMATCH", message: "not your player" };
  }
  return { ok: true, clientId: userId };
}

/**
 * Who is reading (room snapshots): the verified account. In the dev opt-out
 * it is whatever the `X-Client-Id` header claims, or "" (nobody) without one.
 * Callers decide what "nobody" may see.
 */
export async function httpAccount(req: Request): Promise<HttpIdentity> {
  const mode = authMode();
  if (mode === "dev-guest") {
    const raw = req.headers?.["x-client-id"];
    const claim = typeof raw === "string" ? raw.trim().slice(0, 128) : "";
    return { ok: true, clientId: claim };
  }
  return httpIdentity(req, undefined);
}

/** Verify the handshake token once per connection; never rejects the socket. */
export function attachSocketAuth(io: Server): void {
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    void verifyAccessTokenDetailed(token)
      .then((ok) => {
        socket.data.authUserId = ok?.userId ?? null;
        socket.data.authExpMs = ok?.expMs ?? 0;
      })
      .catch(() => {
        socket.data.authUserId = null;
        socket.data.authExpMs = 0;
      })
      .finally(() => next());
  });
}

export type SocketIdentity =
  | { ok: true; clientId: string }
  | { ok: false; code: string; message: string };

/**
 * The player id a socket may use: the user id verified at handshake. Only in
 * the dev opt-out is it the client's claim. Signed-out sockets, and every
 * socket when Supabase is not configured, get no identity and cannot play.
 */
export function socketIdentity(socket: Pick<Socket, "data">, claimed: unknown): SocketIdentity {
  const mode = authMode();
  if (mode === "dev-guest") {
    return typeof claimed === "string" && claimed
      ? { ok: true, clientId: claimed }
      : { ok: false, code: "BAD_HELLO", message: "clientId required" };
  }
  if (mode === "unconfigured") {
    return { ok: false, code: "AUTH_UNCONFIGURED", message: UNCONFIGURED_MESSAGE };
  }
  const id = socket.data?.authUserId;
  return typeof id === "string" && id
    ? { ok: true, clientId: id }
    : { ok: false, code: "AUTH_REQUIRED", message: "Sign in to play." };
}
