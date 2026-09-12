import type { ScoreCard } from "@karaoke/shared";

type Props = {
  you: ScoreCard;
  youName?: string;
  opponent?: ScoreCard | null;
  opponentName?: string;
  /** Ranked: hide opponent (Player A) numbers until match:over. */
  revealOpponent?: boolean;
  winnerId?: string | "draw" | null;
  youId?: string;
  opponentId?: string;
  eloDelta?: number | null;
  shared?: number | null;
  onHome?: () => void;
  onRematch?: () => void;
  onAgain?: () => void;
};

type Band = "great" | "solid" | "okay" | "off";

function bandOf(n: number): Band {
  if (n >= 80) return "great";
  if (n >= 65) return "solid";
  if (n >= 45) return "okay";
  return "off";
}

function bandLabel(band: Band): string {
  if (band === "great") return "Great";
  if (band === "solid") return "Solid";
  if (band === "okay") return "Okay";
  return "Off";
}

export function ResultsModal({
  you,
  youName = "You",
  opponent,
  opponentName = "Them",
  revealOpponent = true,
  winnerId,
  youId,
  opponentId,
  eloDelta,
  shared,
  onHome,
  onRematch,
  onAgain,
}: Props) {
  const locked = Boolean(opponent) && !revealOpponent;
  const title = you.silence
    ? "We couldn't hear you."
    : shared != null
      ? "Duet locked in"
      : winnerId === "draw"
        ? "Draw"
        : winnerId && youId && winnerId === youId
          ? "You take it"
          : winnerId && opponentId && winnerId === opponentId
            ? "They take it"
            : "Score";

  return (
    <div className="modal-scrim">
      <div className="results" role="dialog" aria-labelledby="results-title">
        <h2 id="results-title">{title}</h2>
        <div className={`score-row ${opponent ? "split" : ""}`}>
          <ScoreColumn name={youName} card={you} />
          {opponent ? (
            locked ? (
              <div className="score-col locked">
                <p className="who">{opponentName}</p>
                <p className="overall">--</p>
                <p className="subs">locked in</p>
              </div>
            ) : (
              <ScoreColumn name={opponentName} card={opponent} />
            )
          ) : null}
        </div>
        {shared != null ? <p className="shared">Shared score {shared}</p> : null}
        {eloDelta != null && revealOpponent ? (
          <p className={`elo ${eloDelta >= 0 ? "great" : "off"}`}>
            {eloDelta >= 0 ? `+${eloDelta}` : `${eloDelta}`} ELO
          </p>
        ) : null}
        {you.verdict ? <p className="verdict">{you.verdict}</p> : null}
        <p className="score-how">
          Pitch is how close your notes were to the melody. Tone is how steady and clear your
          voice was. Overall is <strong>70% pitch + 30% tone</strong>.
        </p>
        <div className="result-actions">
          {onAgain ? (
            <button type="button" className="btn gold" onClick={onAgain}>
              Sing again
            </button>
          ) : null}
          {onRematch ? (
            <button type="button" className="btn gold" onClick={onRematch}>
              Rematch
            </button>
          ) : null}
          {onHome ? (
            <button type="button" className="btn ghost" onClick={onHome}>
              Home
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScoreColumn({ name, card }: { name: string; card: ScoreCard }) {
  const overallBand = card.silence ? "off" : bandOf(card.overall);
  return (
    <div className="score-col">
      <p className="who">{name}</p>
      <p className={`overall ${overallBand}`}>{card.overall}</p>
      <p className={`score-grade ${overallBand}`}>{card.silence ? "No vocal" : bandLabel(overallBand)}</p>
      {!card.silence ? (
        <p className="score-mix">
          70% × <strong className={bandOf(card.pitch)}>{card.pitch}</strong> pitch + 30% ×{" "}
          <strong className={bandOf(card.tone)}>{card.tone}</strong> tone
        </p>
      ) : null}
      <div className="score-stats">
        <ScoreStat
          label="Pitch"
          value={card.pitch}
          hint="Notes vs the melody, octave-safe"
          silence={card.silence}
        />
        <ScoreStat
          label="Tone"
          value={card.tone}
          hint="Half clarity, half how steady you held it"
          silence={card.silence}
        />
        {card.words != null ? (
          <ScoreStat label="Words" value={card.words} hint="Lyric accuracy" silence={card.silence} />
        ) : null}
      </div>
    </div>
  );
}

function ScoreStat({
  label,
  value,
  hint,
  silence,
}: {
  label: string;
  value: number;
  hint: string;
  silence: boolean;
}) {
  const band = silence ? "off" : bandOf(value);
  return (
    <div className={`score-stat ${band}`}>
      <div className="score-stat-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="score-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <p className="score-hint">{hint}</p>
    </div>
  );
}
