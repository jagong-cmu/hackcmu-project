import type { ScoreCard } from "@karaoke/shared";
import { useEffect, useState } from "react";
import { ScoreBreakdown, ScoreMeter, scoreBand } from "../scoring/ScoreBars.tsx";
import { coachLine } from "./coachLine.ts";
import {
  composeShareImage,
  shareFilename,
} from "./composeShareImage.ts";
import { ScoreBurst } from "./ScoreBurst.tsx";
import { ShareSheet } from "./ShareSheet.tsx";
import { useCountUp } from "./useCountUp.ts";
import { useMatchMoment } from "./useMatchMoment.ts";

const SCORE_COUNTDOWN_SEC = 6;

const WAIT_LINES = [
  "Reading pitch and tone",
  "Listening for the high notes",
  "Checking the vibe",
  "Counting every wobble",
  "The booth is still talking",
];

export function ScoringWait() {
  const [left, setLeft] = useState(SCORE_COUNTDOWN_SEC);
  const [line, setLine] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      setLeft(Math.max(0, SCORE_COUNTDOWN_SEC - elapsed));
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLine((n) => (n + 1) % WAIT_LINES.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, []);

  const pct = Math.min(100, ((SCORE_COUNTDOWN_SEC - left) / SCORE_COUNTDOWN_SEC) * 100);
  const copy = left > 0 ? WAIT_LINES[line] : "Almost there…";

  return (
    <div className="modal-scrim results-scrim">
      <div className="results scoring-wait booth-wait" role="status" aria-live="polite">
        <div className="booth" aria-hidden="true">
          <span className="booth-sweep" />
          <span className="booth-ring" />
          <span className="booth-ring" />
          <span className="booth-ring" />
          <div className="booth-eq">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <h2 id="results-title">Scoring</h2>
        <p className="scoring-copy" key={copy}>
          {copy}
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
  songTitle?: string;
  songArtist?: string;
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
  songTitle,
  songArtist,
  onHome,
  onRematch,
  onAgain,
}: Props) {
  const moment = useMatchMoment();
  const [sheet, setSheet] = useState<{ url: string; blob: Blob } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const locked = Boolean(opponent) && !revealOpponent;
  const youWon = Boolean(winnerId && youId && winnerId === youId);
  const theyWon = Boolean(winnerId && opponentId && winnerId === opponentId);
  const draw = winnerId === "draw";
  const band = you.silence ? "bad" : scoreBand(you.overall);
  const ranked = Boolean(winnerId && youId);
  const coach = coachLine(you, {
    won: ranked ? youWon : null,
    draw,
    shared,
  });
  const title = you.silence
    ? "Mic check"
    : shared != null
      ? "Duet locked in"
      : draw
        ? "Draw"
        : youWon
          ? "You take it"
          : theyWon
            ? "They take it"
            : coach.kicker;
  const gemini = you.verdict?.trim() ?? "";
  const showGemini =
    Boolean(gemini) &&
    gemini !== coach.line &&
    gemini !== "We couldn't hear you.";

  const heroTarget = shared != null ? shared : you.overall;
  const shown = useCountUp(you.silence ? 0 : heroTarget, true);
  const burstCount = you.silence ? 0 : you.overall >= 80 ? 36 : you.overall >= 55 ? 22 : 0;
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setLanded(true), reduced ? 0 : 1080);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(
    () => () => {
      if (sheet?.url) URL.revokeObjectURL(sheet.url);
    },
    [sheet?.url],
  );

  const openShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const blob = await composeShareImage({
        moment,
        kicker: title,
        songTitle: songTitle ?? "",
        songArtist: songArtist ?? "",
        youName,
        youScore: you.silence ? 0 : you.overall,
        opponentName: opponent ? opponentName : undefined,
        opponentScore:
          opponent && revealOpponent ? (opponent.silence ? 0 : opponent.overall) : null,
        youWon,
        theyWon,
        shared,
        eloDelta: revealOpponent ? eloDelta : null,
        verdict: showGemini ? gemini : "",
      });
      if (sheet?.url) URL.revokeObjectURL(sheet.url);
      setCopied(false);
      setSheet({ url: URL.createObjectURL(blob), blob });
    } catch {
      setSheet(null);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="modal-scrim results-scrim">
      <div
        className={`results results-show band-${band} ${youWon ? "is-win" : ""} ${theyWon ? "is-loss" : ""} ${landed ? "is-landed" : ""}`}
        role="dialog"
        aria-labelledby="results-title"
      >
        <h2 id="results-title">{title}</h2>
        <div className="results-hero">
          {burstCount > 0 ? <ScoreBurst count={burstCount} /> : null}
          <p className="results-hero-score" aria-label={`Score ${heroTarget}`}>
            {you.silence ? "--" : shown}
          </p>
          <p className="results-blurb">{coach.line}</p>
        </div>
        {opponent ? (
          <div className="score-row split">
            <ScoreBreakdown name={youName} card={you} winner={youWon} compact />
            {locked ? (
              <ScoreBreakdown name={opponentName} card={null} pending compact />
            ) : (
              <ScoreBreakdown name={opponentName} card={opponent} winner={theyWon} compact />
            )}
          </div>
        ) : (
          <div className="results-subs">
            <ScoreMeter label="Pitch" value={you.silence ? 0 : you.pitch} />
            <ScoreMeter label="Tone" value={you.silence ? 0 : you.tone} />
          </div>
        )}
        {shared != null ? <p className="shared">Shared score {shared}</p> : null}
        {eloDelta != null && revealOpponent ? (
          <p className={`elo ${eloDelta > 0 ? "up" : eloDelta < 0 ? "down" : ""}`}>
            {eloDelta === 0 ? "ELO unchanged" : `${eloDelta > 0 ? "+" : ""}${eloDelta} ELO`}
          </p>
        ) : null}
        {showGemini ? <p className="verdict">{gemini}</p> : null}
        {moment ? (
          <button type="button" className="results-moment" onClick={() => void openShare()}>
            <img src={moment.url} alt="A still from this match" />
          </button>
        ) : null}
        <div className="result-actions">
          <button type="button" className="cta cta-ghost" disabled={sharing} onClick={() => void openShare()}>
            {sharing ? "Making the card…" : "Share"}
          </button>
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
      {sheet ? (
        <ShareSheet
          url={sheet.url}
          blob={sheet.blob}
          filename={shareFilename(songTitle ?? "match")}
          title={songTitle ? `${title} · ${songTitle}` : title}
          text={
            songTitle
              ? `${title} — ${youName} ${you.silence ? 0 : you.overall}${opponent && revealOpponent ? ` vs ${opponentName} ${opponent.overall}` : ""} on ${songTitle}`
              : title
          }
          copied={copied}
          onCopied={() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          onClose={() => {
            URL.revokeObjectURL(sheet.url);
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}
