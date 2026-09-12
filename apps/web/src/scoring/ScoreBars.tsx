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

export function ScoreMeter({ label, value }: { label: string; value: number }) {
  const n = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`score-meter band-${scoreBand(n)}`}>
      <div className="score-meter-row">
        <span>{label}</span>
        <span>{n}</span>
      </div>
      <div className="score-meter-track">
        <span style={{ width: `${n}%` }} />
      </div>
    </div>
  );
}

export function ScoreBreakdown({
  name,
  card,
  pending,
  compact,
}: {
  name: string;
  card: ScoreBits | null;
  pending?: boolean;
  compact?: boolean;
}) {
  const pitch = card?.pitch ?? 0;
  const tone = card?.tone ?? 0;
  const overall = card?.overall ?? 0;
  const empty = pending || !card;
  return (
    <div className={`score-break band-${empty ? "mid" : scoreBand(overall)} ${empty ? "pending" : ""} ${compact ? "compact" : ""}`}>
      <p className="who">{name}</p>
      <p className="overall">{empty ? "--" : overall}</p>
      {compact ? null : <ScoreMeter label="Score" value={empty ? 0 : overall} />}
      <ScoreMeter label="Pitch" value={empty ? 0 : pitch} />
      <ScoreMeter label="Tone" value={empty ? 0 : tone} />
    </div>
  );
}

export function LiveScoreHud({
  left,
  right,
}: {
  left: { name: string; card: ScoreBits | null };
  right: { name: string; card: ScoreBits | null };
}) {
  return (
    <div className="live-scores">
      <ScoreBreakdown name={left.name} card={left.card} pending={!left.card} compact />
      <ScoreBreakdown name={right.name} card={right.card} pending={!right.card} compact />
    </div>
  );
}
