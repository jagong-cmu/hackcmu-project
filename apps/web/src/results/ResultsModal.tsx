import type { ScoreCard } from "@karaoke/shared";
import { useEffect, useRef, useState } from "react";
import { scoreBand } from "../scoring/ScoreBars.tsx";
import { Button } from "../ui/Button.tsx";
import { Digits } from "../ui/Digits.tsx";
import { coachLine } from "./coachLine.ts";
import {
  composeShareImage,
  shareFilename,
} from "./composeShareImage.ts";
import { extForMime, feedMatchReelResults, waitForCurrentReel } from "./matchReel.ts";
import { buildReelResults, OutroMs, ResultsWaitMs } from "./reelResults.ts";
import { ShareSheet } from "./ShareSheet.tsx";
import { useCountUp } from "./useCountUp.ts";
import { useMatchMoment, useMatchReel, useMatchReelPending } from "./useMatchMoment.ts";
import type { RematchView } from "../stage/rematchView.ts";

const SCORE_COUNTDOWN_SEC = 6;
const CountUpMs = 800;

function Breakdown({ card }: { card: ScoreCard }) {
  return (
    <dl className="km-res-break">
      <div>
        <dt className="t-label">Pitch</dt>
        <dd><Digits value={card.silence ? "--" : `${card.pitch}%`} /></dd>
      </div>
      <div>
        <dt className="t-label">Tone</dt>
        <dd><Digits value={card.silence ? "--" : `${card.tone}%`} /></dd>
      </div>
    </dl>
  );
}

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
  /** Friendly match (private room): show "Unrated" instead of any ELO line. */
  unrated?: boolean;
  shared?: number | null;
  songTitle?: string;
  songArtist?: string;
  onHome?: () => void;
  /** Propose a rematch, or accept the opponent's open offer. */
  onRematch?: () => void;
  /**
   * Server-driven rematch handshake. When set, the Rematch button follows it
   * (propose → waiting/cancel, or accept/decline). Omit for a plain button.
   */
  rematch?: RematchView | null;
  /** Withdraw my offer or decline theirs. */
  onRematchCancel?: () => void;
  onAgain?: () => void;
  /** Leave for the song / mode list. */
  onPickSong?: () => void;
  /** Your real name for the match video ("You" reads oddly in a shared clip). */
  shareName?: string;
  /** The match ended because someone left. */
  forfeit?: boolean;
  /** The opponent's seat emptied before results; show them as left. */
  opponentLeft?: boolean;
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
  eloDelta: eloDeltaIn,
  unrated = false,
  shared,
  songTitle,
  songArtist,
  onHome,
  onRematch,
  rematch,
  onRematchCancel,
  onAgain,
  onPickSong,
  shareName,
  forfeit,
  opponentLeft,
}: Props) {
  // An unrated match never shows (or shares) an ELO change, not even "unchanged".
  const eloDelta = unrated ? null : eloDeltaIn;
  const moment = useMatchMoment();
  const reel = useMatchReel();
  const reelPending = useMatchReelPending();
  const [sheet, setSheet] = useState<{
    url: string;
    blob: Blob;
    kind: "video" | "image";
    owned: boolean;
    filename: string;
  } | null>(null);
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

  // Close the match video on this card. Re-fed whenever the numbers change
  // (Gemini's line lands after the DSP scores); the reel draws the newest.
  const reelFeed = JSON.stringify(
    buildReelResults({
      you,
      youName: shareName?.trim() || youName,
      opponent: opponent ?? null,
      opponentName,
      versus: Boolean(opponent) || Boolean(opponentLeft),
      opponentLeft,
      revealOpponent,
      winnerId,
      youId,
      opponentId,
      eloDelta,
      shared,
      forfeit,
      songTitle,
      songArtist,
      kicker: coach.kicker,
      caption: showGemini ? gemini : coach.line,
    }),
  );
  useEffect(() => {
    feedMatchReelResults(JSON.parse(reelFeed));
  }, [reelFeed]);

  const heroTarget = shared != null ? shared : you.overall;
  const shown = useCountUp(you.silence ? 0 : heroTarget, true, CountUpMs);
  const theirs = useCountUp(opponent && !locked ? opponent.overall : 0, Boolean(opponent && !locked), CountUpMs);
  const versus = Boolean(opponent) || Boolean(opponentLeft) || ranked;
  const headline = you.silence
    ? "Mic check"
    : shared != null
      ? "Duet"
      : draw
        ? "Draw"
        : youWon
          ? "You win"
          : theyWon
            ? "They win"
            : title;
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setLanded(true), reduced ? 0 : 1080);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(
    () => () => {
      if (sheet?.owned && sheet.url) URL.revokeObjectURL(sheet.url);
    },
    [sheet?.url, sheet?.owned],
  );

  const openShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // A held reel may still be waiting on scores or rendering its outro.
      const video = reel ?? (await waitForCurrentReel(ResultsWaitMs + OutroMs + 2500));
      if (video) {
        if (sheet?.owned && sheet.url) URL.revokeObjectURL(sheet.url);
        setCopied(false);
        setSheet({
          url: video.url,
          blob: video.blob,
          kind: "video",
          owned: false,
          filename: shareFilename(songTitle ?? "match", extForMime(video.mime)),
        });
        return;
      }
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
      if (sheet?.owned && sheet.url) URL.revokeObjectURL(sheet.url);
      setCopied(false);
      setSheet({
        url: URL.createObjectURL(blob),
        blob,
        kind: "image",
        owned: true,
        filename: shareFilename(songTitle ?? "match"),
      });
    } catch {
      setSheet(null);
    } finally {
      setSharing(false);
    }
  };

  // Keyboard players land on the first action (Sing again / Rematch) instead of <body>.
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="modal-scrim results-scrim">
      <div
        className={`results results-show km-results band-${band} ${youWon ? "is-win" : ""} ${theyWon ? "is-loss" : ""} ${landed ? "is-landed" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-title"
      >
        {songTitle ? <p className="km-res-song t-label">{songTitle}{songArtist ? ` · ${songArtist}` : ""}</p> : null}
        {versus ? (
          <>
            <h2 id="results-title" className="km-res-head">{headline}</h2>
            <div className="km-res-scores">
              <div className="km-res-side you">
                <p className="t-label">{shared != null ? "Team" : youName}</p>
                <p className="km-res-num"><Digits value={you.silence ? "--" : shown} /></p>
                <Breakdown card={you} />
              </div>
              {shared != null ? null : (
                <div className="km-res-side them">
                  <p className="t-label">{opponentName}</p>
                  <p className="km-res-num"><Digits value={locked || !opponent || opponent.silence ? "--" : theirs} /></p>
                  {locked || !opponent ? null : <Breakdown card={opponent} />}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 id="results-title" className="km-res-head km-res-num" aria-label={you.silence ? "Mic check" : `Score ${heroTarget}`}>
              {you.silence ? "Mic check" : <Digits value={shown} />}
            </h2>
            <Breakdown card={you} />
          </>
        )}
        {unrated && revealOpponent ? <p className="elo friendly t-label">Unrated · friendly match</p> : null}
        {eloDelta != null && revealOpponent ? (
          <p className={`elo t-label ${eloDelta > 0 ? "up" : eloDelta < 0 ? "down" : ""}`}>
            {eloDelta === 0 ? "ELO unchanged" : <><Digits value={`${eloDelta > 0 ? "+" : "−"}${Math.abs(eloDelta)}`} /> ELO</>}
          </p>
        ) : null}
        <p className="results-blurb">{showGemini ? gemini : coach.line}</p>
        <p className="sr-only" aria-live="polite">
          {landed ? `Final score ${you.silence ? "none" : heroTarget}${opponent && !locked && shared == null ? `, ${opponentName} ${opponent.overall}` : ""}` : ""}
        </p>
        {reel || moment || reelPending ? (
          <button type="button" className="results-moment" onClick={() => void openShare()}>
            {moment ? (
              <img src={moment.url} alt="" />
            ) : reel ? (
              <video src={reel.url} muted playsInline preload="metadata" />
            ) : (
              <span className="moment-pending" aria-hidden="true" />
            )}
            <span className="moment-label">{reel ? "Match video" : reelPending ? "Finishing video…" : "Share"}</span>
          </button>
        ) : null}
        {rematch && rematch.kind !== "idle" ? (
          <p
            className={`rematch-status rematch-${rematch.kind}`}
            role="status"
            aria-live="polite"
          >
            {rematch.kind === "waiting"
              ? `Waiting for ${rematch.opponentName}… ${rematch.secondsLeft}s`
              : rematch.kind === "invited"
                ? `${rematch.opponentName} wants a rematch`
                : rematch.notice}
          </p>
        ) : rematch?.notice ? (
          <p className="rematch-status rematch-lapsed" role="status" aria-live="polite">
            {rematch.notice}
          </p>
        ) : null}
        <div className="result-actions" ref={actionsRef}>
          {onAgain ? (
            <Button variant="primary" onClick={onAgain}>
              Sing again
            </Button>
          ) : null}
          {onRematch && rematch?.kind === "invited" ? (
            <Button variant="primary" onClick={onRematch}>
              Accept ({rematch.secondsLeft}s)
            </Button>
          ) : null}
          {onRematchCancel && rematch?.kind === "invited" ? (
            <Button variant="secondary" onClick={onRematchCancel}>
              Decline
            </Button>
          ) : null}
          {onRematchCancel && rematch?.kind === "waiting" ? (
            <Button variant="secondary" onClick={onRematchCancel}>
              Cancel
            </Button>
          ) : null}
          {onRematch && (!rematch || rematch.kind === "idle") ? (
            <Button variant="primary" onClick={onRematch}>
              Rematch
            </Button>
          ) : null}
          {onPickSong ? (
            <Button variant="secondary" onClick={onPickSong}>
              Pick another song
            </Button>
          ) : null}
          {onHome ? (
            <Button variant="ghost" onClick={onHome}>
              Home
            </Button>
          ) : null}
          <Button variant="ghost" disabled={sharing} onClick={() => void openShare()}>
            {sharing ? (reelPending ? "Finishing video…" : "Making the clip…") : "Share"}
          </Button>
        </div>
      </div>
      {sheet ? (
        <ShareSheet
          url={sheet.url}
          blob={sheet.blob}
          filename={sheet.filename}
          kind={sheet.kind}
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
            if (sheet.owned) URL.revokeObjectURL(sheet.url);
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}
