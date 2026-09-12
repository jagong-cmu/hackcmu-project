/**
 * LANE A — wall-clock offset between this browser and the server.
 *
 * The server schedules playback as an absolute `playAtUnixMs`. Two laptops with
 * clocks a few hundred ms apart would start the same clip visibly out of step,
 * so we measure the offset instead of trusting Date.now().
 *
 * Uses the existing /api/health route — no new protocol events.
 */
const ROUNDS = 5;

let offsetMs = 0;

/** server_now - client_now, median of several round trips. */
export function clockOffsetMs(): number {
  return offsetMs;
}

/** Server time as this client best understands it. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export async function syncClock(): Promise<number> {
  const samples: number[] = [];

  for (let i = 0; i < ROUNDS; i++) {
    const sent = Date.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const received = Date.now();
      const body = (await res.json()) as { serverTimeMs?: number };
      if (typeof body.serverTimeMs !== "number") continue;

      // Assume a symmetric round trip: the server's clock reading lines up with
      // the midpoint of our send and receive timestamps.
      const midpoint = sent + (received - sent) / 2;
      samples.push(body.serverTimeMs - midpoint);
    } catch {
      // Offline or server asleep; keep whatever offset we already had.
    }
  }

  if (samples.length > 0) {
    samples.sort((a, b) => a - b);
    offsetMs = samples[Math.floor(samples.length / 2)] ?? 0;
  }
  return offsetMs;
}
