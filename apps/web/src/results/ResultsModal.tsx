import type { ScoreCard } from "@karaoke/shared";
import { ScoreBreakdown } from "../scoring/ScoreBars.tsx";

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
          <ScoreBreakdown name={youName} card={you} />
          {opponent ? (
            locked ? (
              <ScoreBreakdown name={opponentName} card={null} pending />
            ) : (
              <ScoreBreakdown name={opponentName} card={opponent} />
            )
          ) : null}
        </div>
        {shared != null ? <p className="shared">Shared score {shared}</p> : null}
        {eloDelta != null && revealOpponent ? (
          <p className="elo">{eloDelta >= 0 ? `+${eloDelta}` : `${eloDelta}`} ELO</p>
        ) : null}
        {you.verdict ? <p className="verdict">{you.verdict}</p> : null}
        <div className="result-actions">
          {onAgain ? (
            <button type="button" className="cta" onClick={onAgain}>
              Sing again
            </button>
          ) : null}
          {onRematch ? (
            <button type="button" className="cta" onClick={onRematch}>
              Rematch
            </button>
          ) : null}
          {onHome ? (
            <button type="button" className="cta cta-ghost" onClick={onHome}>
              Home
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
