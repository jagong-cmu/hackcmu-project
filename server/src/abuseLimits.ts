/**
 * Abuse limits for room codes and sign-in checks.
 *
 * Private room codes are 4 digits (a product decision: they are read out loud
 * and typed on phones), so there are only 10,000 of them. Three things keep
 * them from being enumerated:
 *
 * - One answer for every miss. A code that does not exist, a room that is
 *   full, and a room of the wrong mode all get the same ROOM_UNAVAILABLE
 *   error on join, and GET /api/rooms/:code answers the same 404 for "no such
 *   room" and "you are not seated there". Only someone seated learns more.
 * - Failed joins are limited per verified account (per socket in the dev
 *   opt-out): JoinFailLimit distinct codes per JoinFailWindowMs, then a
 *   JoinCooldownMs cool-down in which every join to a private code is refused
 *   before any lookup. Successful joins and retries of a code already counted
 *   are free, so the Stage's 800ms join retry never trips it.
 * - Public codes (the demo room, `chaos-N` lounges) are not secret and are
 *   never limited.
 *
 * All of this is per server instance. On Vercel each instance keeps its own
 * counters, so the effective limit is JoinFailLimit x instances. A shared
 * (Mongo) limiter is an open item in docs/hardening-log.md.
 */
import { DemoRoomCode, isPublicChaosCode } from "@karaoke/shared";

export const JoinFailLimit = 8;
export const JoinFailWindowMs = 5 * 60_000;
export const JoinCooldownMs = 5 * 60_000;

/** The one error for "can't join that private code", whatever the reason. */
export const RoomUnavailableCode = "ROOM_UNAVAILABLE";
export const JoinRateLimitedCode = "JOIN_RATE_LIMITED";

export function roomUnavailableMessage(code: string): string {
  return `Can't join room ${code}. Check the code. The room may be full or closed.`;
}

export function joinRateLimitedMessage(waitMs: number): string {
  const min = Math.max(1, Math.ceil(waitMs / 60_000));
  return `Too many room codes tried. Wait ${min} minute${min === 1 ? "" : "s"} and try again.`;
}

/** Private codes are secret and limited; the demo room and public lounges are not. */
export function isGuardedRoomCode(code: string): boolean {
  return Boolean(code) && code !== DemoRoomCode && !isPublicChaosCode(code);
}

type Attempts = {
  /** code -> when it first failed in the current window */
  failed: Map<string, number>;
  cooldownUntil: number;
};

/**
 * Counts distinct private codes a caller failed to join. Bounded: at most
 * `maxKeys` callers are tracked; the oldest-touched are dropped first.
 */
export class JoinAttemptLimiter {
  private byKey = new Map<string, Attempts>();

  constructor(
    readonly limit = JoinFailLimit,
    readonly windowMs = JoinFailWindowMs,
    readonly cooldownMs = JoinCooldownMs,
    readonly maxKeys = 10_000,
  ) {}

  /** Milliseconds left in this caller's cool-down, or 0 when they may try. */
  waitMs(key: string, now = Date.now()): number {
    const entry = this.byKey.get(key);
    if (!entry) return 0;
    if (entry.cooldownUntil > now) return entry.cooldownUntil - now;
    if (entry.cooldownUntil > 0) {
      // Cool-down served: start clean.
      this.byKey.delete(key);
      return 0;
    }
    this.expire(key, entry, now);
    return 0;
  }

  /**
   * Record a failed join of `code`. Returns true when this failure started a
   * cool-down. A code already counted in this window is not counted again.
   */
  fail(key: string, code: string, now = Date.now()): boolean {
    let entry = this.byKey.get(key);
    if (entry && entry.cooldownUntil > now) return false;
    if (!entry || entry.cooldownUntil > 0) {
      entry = { failed: new Map(), cooldownUntil: 0 };
    }
    this.expire(key, entry, now);
    if (!entry.failed.has(code)) entry.failed.set(code, now);
    // Re-insert so Map order tracks recency for eviction.
    this.byKey.delete(key);
    this.byKey.set(key, entry);
    this.evict();
    if (entry.failed.size >= this.limit) {
      entry.cooldownUntil = now + this.cooldownMs;
      entry.failed.clear();
      return true;
    }
    return false;
  }

  /** How many callers are tracked (for tests and bounds checks). */
  get size(): number {
    return this.byKey.size;
  }

  reset(): void {
    this.byKey.clear();
  }

  private expire(key: string, entry: Attempts, now: number): void {
    for (const [code, at] of entry.failed) {
      if (now - at >= this.windowMs) entry.failed.delete(code);
    }
    if (entry.failed.size === 0 && entry.cooldownUntil === 0) this.byKey.delete(key);
  }

  private evict(): void {
    while (this.byKey.size > this.maxKeys) {
      const oldest = this.byKey.keys().next().value;
      if (oldest === undefined) break;
      this.byKey.delete(oldest);
    }
  }
}

/** Limiter key: the verified account when there is one, else this socket. */
export function joinLimitKey(verifiedUserId: unknown, socketId: string): string {
  return typeof verifiedUserId === "string" && verifiedUserId ? `u:${verifiedUserId}` : `s:${socketId}`;
}

/**
 * Sliding-window gate for one socket: true while under `limit` calls per
 * `windowMs`. Used for player:hello token verification.
 */
export function createWindowGate(limit: number, windowMs: number): (now?: number) => boolean {
  let hits: number[] = [];
  return (now = Date.now()) => {
    hits = hits.filter((t) => now - t < windowMs && t <= now);
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

// ---------------------------------------------------------------------------
// room:create. Each create reserves a 4-digit code in liveRooms (liveState.ts),
// so a loop of creates could hold most of the 10,000 codes. Limited per
// verified account (per socket in the dev opt-out), like failed joins.
// ---------------------------------------------------------------------------

/** room:create calls allowed per caller per RoomCreateWindowMs (all at once is fine). */
export const RoomCreateLimit = 6;
export const RoomCreateWindowMs = 5 * 60_000;
export const CreateRateLimitedCode = "CREATE_RATE_LIMITED";

export function createRateLimitedMessage(waitMs: number): string {
  const min = Math.max(1, Math.ceil(waitMs / 60_000));
  return `You've made a lot of rooms. Wait ${min} minute${min === 1 ? "" : "s"} and try again, or join a friend's code.`;
}

/**
 * Sliding window per key: at most `limit` hits per `windowMs`, in any burst.
 * Bounded to `maxKeys` keys, least recently used dropped first.
 */
export class WindowLimiter {
  private byKey = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxKeys = 10_000,
  ) {}

  /**
   * Spend one hit for `key`. Returns 0 when allowed, else the ms until the
   * oldest hit in the window ages out (nothing is spent then).
   */
  take(key: string, now = Date.now()): number {
    const hits = (this.byKey.get(key) ?? []).filter((t) => now - t < this.windowMs && t <= now);
    let wait = 0;
    if (hits.length >= this.limit) wait = Math.max(1, hits[0]! + this.windowMs - now);
    else hits.push(now);
    this.byKey.delete(key);
    if (hits.length) this.byKey.set(key, hits);
    while (this.byKey.size > this.maxKeys) {
      const oldest = this.byKey.keys().next().value;
      if (oldest === undefined) break;
      this.byKey.delete(oldest);
    }
    return wait;
  }

  get size(): number {
    return this.byKey.size;
  }

  reset(): void {
    this.byKey.clear();
  }
}

/** player:hello may trigger at most this many token verifications per socket per window. */
export const HelloVerifyLimit = 5;
export const HelloVerifyWindowMs = 30_000;

/**
 * May this caller read a room snapshot? Only when seated there. Everyone
 * else, including signed-in strangers, gets the same 404 as "no such room".
 */
export function canReadRoom(
  room: { players: ReadonlyArray<{ clientId: string }> } | undefined,
  clientId: string,
): boolean {
  if (!room || !clientId) return false;
  return room.players.some((p) => p.clientId === clientId);
}

export const RoomSnapshotNotFound = { code: "ROOM_NOT_FOUND", message: "no such room" } as const;

// ---------------------------------------------------------------------------
// Gemini verdicts and training analytics (audit #9).
//
// Every non-silent score could cost one Gemini call (the free AI Studio quota
// is shared by everyone) and every training post one PostHog event. Turn
// scores are already one per seat per match (scoreRoute.ts); training posts
// had no limit at all. Over the limit the caller still gets its DSP score,
// just with the no-Gemini verdict (empty; the client shows its coach line).
// Per instance, like every limiter here.
// ---------------------------------------------------------------------------

/** At most one Gemini verdict per user per this many ms... */
export const VerdictMinGapMs = 15_000;
/** ...and this many per user per hour. */
export const VerdictHourlyLimit = 30;
/** Gemini calls in flight on one instance. Beyond this, the verdict is skipped. */
export const VerdictMaxInFlight = 4;
/** Training "completed" analytics (PostHog event + stats bump) per user per hour. */
export const TrainingEventHourlyLimit = 30;
export const TrainingEventMinGapMs = 15_000;

const HourMs = 60 * 60_000;

/**
 * Per-key budget: at most `perHour` hits per rolling hour and at least
 * `minGapMs` between hits. Bounded to `maxKeys` keys, least recently used
 * dropped first.
 */
export class KeyedBudget {
  private byKey = new Map<string, number[]>();

  constructor(
    readonly minGapMs: number,
    readonly perHour: number,
    readonly maxKeys = 10_000,
  ) {}

  /** Spend one hit for `key` if the budget allows it. */
  take(key: string, now = Date.now()): boolean {
    const hits = (this.byKey.get(key) ?? []).filter((t) => now - t < HourMs && t <= now);
    const last = hits[hits.length - 1];
    const ok = hits.length < this.perHour && (last === undefined || now - last >= this.minGapMs);
    if (ok) hits.push(now);
    this.byKey.delete(key);
    if (hits.length) this.byKey.set(key, hits);
    while (this.byKey.size > this.maxKeys) {
      const oldest = this.byKey.keys().next().value;
      if (oldest === undefined) break;
      this.byKey.delete(oldest);
    }
    return ok;
  }

  get size(): number {
    return this.byKey.size;
  }

  reset(): void {
    this.byKey.clear();
  }
}

/** Counts in-flight work; `tryEnter` refuses past `max` instead of queueing. */
export class ConcurrencyCap {
  private active = 0;
  constructor(readonly max: number) {}

  tryEnter(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  leave(): void {
    if (this.active > 0) this.active--;
  }

  get inFlight(): number {
    return this.active;
  }
}

export const verdictBudget = new KeyedBudget(VerdictMinGapMs, VerdictHourlyLimit);
export const verdictConcurrency = new ConcurrencyCap(VerdictMaxInFlight);
export const trainingEventBudget = new KeyedBudget(TrainingEventMinGapMs, TrainingEventHourlyLimit);
