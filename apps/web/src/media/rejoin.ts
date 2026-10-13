/**
 * LANE A — when to rejoin LiveKit from scratch after an unexpected drop.
 *
 * LiveKit join tokens are short-lived (15 min, server/src/livekit.ts). A
 * connected participant is unaffected: the LiveKit server pushes refreshed
 * tokens down the live connection and the SDK uses them for its own
 * resume/reconnect. But once the SDK gives up and the room is Disconnected,
 * the original token may be long expired, so the stage asks our server for a
 * fresh one (which also re-checks the seat and any ban) and connects again.
 */

/** Rejoins allowed per stage mount (per room + identity). */
export const MaxRejoins = 5;

/**
 * Delay before rejoin number `attempt` (1-based), or null to stay
 * disconnected: we left on purpose, the same identity joined elsewhere, or
 * we are out of attempts.
 */
export function rejoinDelayMs(attempt: number, opts: { intentional: boolean }): number | null {
  if (opts.intentional) return null;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MaxRejoins) return null;
  return Math.min(8000, 1000 * 2 ** (attempt - 1));
}

/**
 * A token fetch / connect failed. During a rejoin (403 NOT_SEATED before the
 * Stage re-seats us, a network blip) no further Disconnected event will
 * fire, so schedule the next attempt here, on the same budget. Outside a
 * rejoin (first connect), or when the failure is permanent (no LiveKit
 * keys), stay in the error state.
 */
export function retryFailedConnectMs(
  attempt: number,
  opts: { intentional: boolean; rejoining: boolean; permanent: boolean },
): number | null {
  if (!opts.rejoining || opts.permanent) return null;
  return rejoinDelayMs(attempt, { intentional: opts.intentional });
}

/**
 * The page came back from the back/forward cache. pagehide already sent
 * room:leave and the server dropped our media, so rejoin from scratch with a
 * fresh budget, unless we left on purpose. A normal (non-persisted) load
 * mounts fresh and needs nothing.
 */
export function rejoinOnPageShow(opts: { persisted: boolean; intentional: boolean }): boolean {
  return opts.persisted && !opts.intentional;
}
