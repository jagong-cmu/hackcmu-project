/**
 * Crash and input guards shared by every server entry point.
 *
 * One bad payload must never take the process down: on Vercel a crash kills
 * the instance and every live match on it. Express 4 does not catch rejected
 * async handlers, Socket.IO does not catch throwing listeners, and Node 22
 * exits on an unhandled rejection, so every boundary goes through here.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LOG_EVERY_MS = 30_000;
const lastLogged = new Map<string, { at: number; suppressed: number }>();

function describe(err: unknown): string {
  try {
    if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300);
    return String(err).slice(0, 300);
  } catch {
    return "unprintable error";
  }
}

/**
 * A `.catch` handler for fire-and-forget promises: one concise line per tag,
 * at most once every 30s (with a count of what was swallowed in between), so
 * a flapping Mongo cannot flood the logs.
 */
export function logOnce(tag: string): (err: unknown) => void {
  return (err: unknown) => {
    const now = Date.now();
    const seen = lastLogged.get(tag);
    if (seen && now - seen.at < LOG_EVERY_MS) {
      seen.suppressed += 1;
      return;
    }
    const extra = seen?.suppressed ? ` (+${seen.suppressed} suppressed)` : "";
    lastLogged.set(tag, { at: now, suppressed: 0 });
    if (lastLogged.size > 500) lastLogged.clear();
    console.error(`[guard] ${tag}: ${describe(err)}${extra}`);
  };
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

const INTERNAL_BODY = { ok: false, code: "INTERNAL", message: "Something went wrong. Try again." };

/** Wrap an async Express handler: a throw or rejection becomes a 500 JSON reply. */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    const fail = (err: unknown) => {
      logOnce(`route ${req.method} ${req.route?.path ?? req.path}`)(err);
      if (!res.headersSent) res.status(500).json(INTERNAL_BODY);
    };
    try {
      Promise.resolve(fn(req, res, next)).catch(fail);
    } catch (err) {
      fail(err);
    }
  };
}

/**
 * Last Express middleware: body-parser errors (bad JSON, too large) keep
 * their 4xx, anything else is a 500. Always JSON, never a stack trace.
 */
export function jsonErrors(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const raw = (err as { status?: unknown; statusCode?: unknown } | null) ?? {};
  const status = Number.isInteger(raw.status) ? Number(raw.status) : Number(raw.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    if (!res.headersSent) res.status(status).json({ ok: false, code: "BAD_REQUEST", message: "bad request" });
    return;
  }
  logOnce(`express ${req.method} ${req.path}`)(err);
  if (!res.headersSent) res.status(500).json(INTERNAL_BODY);
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

type Emitter = { emit: (event: string, payload: unknown) => unknown };

/**
 * Wrap a socket listener (sync or async). A throw or rejection is logged and
 * the client gets the standard `error` event with code INTERNAL.
 */
export function safeHandler<A extends unknown[]>(
  socket: Emitter,
  event: string,
  fn: (...args: A) => unknown,
): (...args: A) => void {
  return (...args: A) => {
    const fail = (err: unknown) => {
      logOnce(`socket ${event}`)(err);
      try {
        socket.emit("error", { code: "INTERNAL", message: "Something went wrong. Try again." });
      } catch {
        /* socket already gone */
      }
    };
    try {
      Promise.resolve(fn(...args)).catch(fail);
    } catch (err) {
      fail(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

let guardsInstalled = false;

/**
 * Last-resort loggers. Their presence stops Node 22 from exiting on an
 * unhandled rejection or an uncaught exception; everything above should
 * already have caught it, so these only log.
 */
export function installProcessGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on("unhandledRejection", (reason) => logOnce("unhandledRejection")(reason));
  process.on("uncaughtException", (err) => logOnce("uncaughtException")(err));
}

// ---------------------------------------------------------------------------
// Input coercion
// ---------------------------------------------------------------------------

export const DisplayNameMax = 16;
export const DefaultDisplayName = "Singer";

// Invisible letters that are not in \p{C}: Hangul fillers, combining grapheme joiner.
const INVISIBLE_LETTERS = /[\u115F\u1160\u3164\uFFA0\u034F]/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Display names: NFKC, no control / format characters (bidi overrides,
 * zero-width joiners, isolates), no Zalgo stacks, whitespace collapsed,
 * at most 16 characters. Anything without a visible character is "Singer".
 */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return DefaultDisplayName;
  let name = raw.slice(0, 256).normalize("NFKC");
  name = name
    .replace(/\p{Cc}/gu, " ")
    .replace(/\p{C}/gu, "")
    .replace(INVISIBLE_LETTERS, "")
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .replace(/[\s\p{Z}]+/gu, " ")
    .trim();
  name = Array.from(name).slice(0, DisplayNameMax).join("").trim();
  return VISIBLE.test(name) ? name : DefaultDisplayName;
}

/**
 * Free text from a client (lyrics, notes): string-only, control and format
 * characters removed (newlines kept when `multiline`), capped at `max`.
 */
export function cleanText(raw: unknown, max: number, opts: { multiline?: boolean } = {}): string {
  if (typeof raw !== "string") return "";
  let text = raw.slice(0, max * 2);
  text = opts.multiline
    ? text
        .replace(/\r\n?/g, "\n")
        .replace(/[^\P{Cc}\n]/gu, " ")
        .replace(/[^\P{C}\n]/gu, "")
    : text.replace(/\p{Cc}/gu, " ").replace(/\p{C}/gu, "");
  text = text.replace(/[ \p{Zs}]+/gu, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim().slice(0, max);
}

/** A room code from a client: a short trimmed string, else "". */
export function roomCodeOf(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const code = raw.trim();
  return code.length > 0 && code.length <= 32 ? code : "";
}

/** A finite number clamped to [min, max], else `fallback`. Never coerces. */
export function finiteIn(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

// ---------------------------------------------------------------------------
// pitch:live
// ---------------------------------------------------------------------------

export const PitchLiveMaxPerSec = 20;

/** Per-socket fixed-window limiter: true while under `maxPerSec` this second. */
export function createRateGate(maxPerSec = PitchLiveMaxPerSec): (now?: number) => boolean {
  let windowStart = 0;
  let count = 0;
  return (now = Date.now()) => {
    if (now - windowStart >= 1000 || now < windowStart) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= maxPerSec;
  };
}

export type PitchLiveRelay = {
  hz: number | null;
  clarity: number;
  rms: number;
  pitch?: number;
  tone?: number;
  overall?: number;
};

/** The relayable part of a pitch:live payload, every number finite and in range. */
export function sanitizePitchSample(payload: unknown): PitchLiveRelay {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const hz =
    typeof body.hz === "number" && Number.isFinite(body.hz) && body.hz > 0 && body.hz <= 5000
      ? body.hz
      : null;
  const score = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined;
  return {
    hz,
    clarity: finiteIn(body.clarity, 0, 1, 0),
    rms: finiteIn(body.rms, 0, 1, 0),
    pitch: score(body.pitch),
    tone: score(body.tone),
    overall: score(body.overall),
  };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/**
 * Memoize an async producer for `ttlMs`, sharing one in-flight call.
 * A rejection is not cached.
 */
export function memoizeFor<T>(
  ttlMs: number,
  produce: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  return () => {
    if (value && now() - value.at < ttlMs) return Promise.resolve(value.v);
    if (inflight) return inflight;
    inflight = produce()
      .then((v) => {
        value = { at: now(), v };
        return v;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
