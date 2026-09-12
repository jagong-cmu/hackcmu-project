import type { ScoreCard } from "@karaoke/shared";
import { useEffect, useState } from "react";
import { ScoreBreakdown } from "../scoring/ScoreBars.tsx";

const SCORE_COUNTDOWN_SEC = 6;

export function ScoringWait() {
  const [left, setLeft] = useState(SCORE_COUNTDOWN_SEC);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      setLeft(Math.max(0, SCORE_COUNTDOWN_SEC - elapsed));
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  const pct = Math.min(100, ((SCORE_COUNTDOWN_SEC - left) / SCORE_COUNTDOWN_SEC) * 100);
  const seconds = Math.ceil(left);

  return (
    <div className="modal-scrim">
      <div className="results scoring-wait" role="status" aria-live="polite">
        <h2 id="results-title">Scoring</h2>
        <p className="scoring-copy">
          {seconds > 0 ? `Reading pitch and tone · ${seconds}s` : "Almost there…"}
        </p>
        <div className="scoring-track">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

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
          <p className="elo">
            {eloDelta === 0 ? "ELO unchanged" : `${eloDelta > 0 ? "+" : ""}${eloDelta} ELO`}
          </p>
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
