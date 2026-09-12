import type { MelodyFile, ScoreCard } from "@karaoke/shared";
import { centsError, centsToPitch, jitterToStability, midiFromHz } from "./cents.ts";

export type PitchFrame = {
  timeSec: number;
  hz: number | null;
  clarity: number;
};

export function melodyHzAt(melody: MelodyFile, timeSec: number): number | null {
  const i = Math.round((timeSec - melody.startSec) * melody.sampleRateHz);
  if (i < 0 || i >= melody.hz.length) return null;
  const hz = melody.hz[i];
  return hz == null ? null : hz;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function scoreContour(
  frames: PitchFrame[],
  melody: MelodyFile,
  clip: { startSec: number; durationSec: number },
  /**
   * Duet: only the seat's own lines count. Without this a singer is scored
   * through their partner's lines too, where they are correctly silent.
   */
  windows?: Array<{ startSec: number; endSec: number }>,
): ScoreCard {
  const end = clip.startSec + clip.durationSec;
  const inWindows = (t: number) =>
    !windows || windows.length === 0 || windows.some((w) => t >= w.startSec && t <= w.endSec);

  const windowed = frames.filter(
    (f) => f.timeSec >= clip.startSec && f.timeSec <= end && inWindows(f.timeSec),
  );

  const errors: number[] = [];
  const residuals: number[] = [];
  const clarities: number[] = [];
  let melodyVoiced = 0;

  const step = 1 / melody.sampleRateHz;
  for (let t = clip.startSec; t < end; t += step) {
    const target = melodyHzAt(melody, t);
    if (target == null) continue;
    if (!inWindows(t)) continue;
    melodyVoiced += 1;
  }

  for (const f of windowed) {
    const target = melodyHzAt(melody, f.timeSec);
    if (target == null) continue;
    if (f.hz == null || f.clarity < 0.5 || f.hz < 55 || f.hz > 1200) continue;
    const err = centsError(f.hz, target);
    if (!Number.isFinite(err)) continue;
    errors.push(err);
    let residual = midiFromHz(f.hz) - midiFromHz(target);
    residual -= 12 * Math.round(residual / 12);
    residuals.push(residual);
    clarities.push(f.clarity);
  }

  // ~5 pitched frames is a real take. The old 12% coverage gate marked short
  // or pitchy-sparse singing as silence ("We couldn't hear you.").
  const silence = errors.length < 5 || (melodyVoiced > 0 && errors.length / melodyVoiced < 0.04);
  if (silence) {
    return {
      overall: 0,
      pitch: 0,
      tone: 0,
      silence: true,
      verdict: "We couldn't hear you.",
      source: "dsp",
    };
  }

  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const pitch = centsToPitch(mae);

  const successive: number[] = [];
  for (let i = 1; i < residuals.length; i++) {
    successive.push(residuals[i] - residuals[i - 1]);
  }
  const stability = jitterToStability(std(successive));
  const clarityScore = Math.round(
    (clarities.reduce((a, b) => a + b, 0) / clarities.length) * 100,
  );
  const tone = Math.round(Math.max(0, Math.min(100, 0.5 * clarityScore + 0.5 * stability)));
  const overall = Math.round(0.7 * pitch + 0.3 * tone);

  return {
    overall,
    pitch,
    tone,
    silence: false,
    verdict: "",
    source: "dsp",
  };
}
