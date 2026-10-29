export type ScoreBits = {
  pitch: number;
  tone: number;
  overall: number;
};

export function scoreBand(n: number): "good" | "mid" | "bad" {
  if (n >= 80) return "good";
  if (n >= 55) return "mid";
  return "bad";
}
