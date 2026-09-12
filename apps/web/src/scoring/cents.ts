export function midiFromHz(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Octave-invariant absolute cents error. */
export function centsError(sungHz: number, targetHz: number): number {
  if (!(sungHz > 0) || !(targetHz > 0)) return Infinity;
  const sung = midiFromHz(sungHz);
  const target = midiFromHz(targetHz);
  let diff = sung - target;
  diff -= 12 * Math.round(diff / 12);
  return Math.abs(diff) * 100;
}

/**
 * Casual in-tune chorus should land 70–85, not 12.
 * Anchors from a decent laptop take: ~20–40 cents MAE after octave wrap.
 */
export function centsToPitch(meanAbsCents: number): number {
  const mae = Math.max(0, meanAbsCents);
  const pts: Array<[number, number]> = [
    [0, 98],
    [12, 90],
    [25, 82],
    [40, 74],
    [55, 68],
    [80, 52],
    [120, 32],
    [200, 12],
    [320, 0],
  ];
  if (mae <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    if (mae <= x2) {
      const t = (mae - x1) / (x2 - x1);
      return Math.round(y1 + t * (y2 - y1));
    }
  }
  return 0;
}

export function jitterToStability(semitoneStd: number): number {
  const s = Math.max(0, semitoneStd);
  return Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-s / 0.55))));
}
