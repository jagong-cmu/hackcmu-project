/**
 * The time the lyrics show: the backing track's own clock, moved back by what
 * the output path delays it, and by the singer's per-device offset.
 */

const OffsetKey = "karaoke.lyricOffsetMs";
export const LyricOffsetStepMs = 10;
export const LyricOffsetMaxMs = 500;

export function getLyricOffsetMs(): number {
  try {
    const ms = Number(localStorage.getItem(OffsetKey) ?? 0);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

export function setLyricOffsetMs(ms: number): number {
  const v = Math.max(-LyricOffsetMaxMs, Math.min(LyricOffsetMaxMs, Math.round(ms)));
  try {
    localStorage.setItem(OffsetKey, String(v));
  } catch {
    /* private window: the setting lasts this page only */
  }
  offsetMs = v;
  return v;
}

let offsetMs = getLyricOffsetMs();

/**
 * Seconds between what a context renders now and what the speakers play now.
 * The <audio> element shares the output device, so this stands in for its
 * own delay, which no browser API reports.
 */
export function outputDelaySec(ctx: AudioContext | null | undefined): number {
  if (!ctx || ctx.state !== "running") return 0;
  const ts = ctx.getOutputTimestamp?.();
  if (ts?.contextTime != null && ts.performanceTime) {
    const heard = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    const d = ctx.currentTime - heard;
    if (d >= 0 && d < 1) return d;
  }
  return (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0);
}

/** Last values lyricTime used, for the dev overlay. */
export const lyricClockDebug = { audioSec: 0, latencySec: 0, offsetMs: 0 };

/** Song seconds the singer is hearing, from the track's clock (audio.currentTime). */
export function lyricTime(audioSec: number, ctx: AudioContext | null | undefined): number {
  const latencySec = outputDelaySec(ctx);
  Object.assign(lyricClockDebug, { audioSec, latencySec, offsetMs });
  // Positive offset = lyrics later (Bluetooth headphones play late).
  return audioSec - latencySec - offsetMs / 1000;
}
