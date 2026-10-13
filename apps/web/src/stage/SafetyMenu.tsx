/**
 * The "…" on every remote camera tile: report, block, remove.
 *
 * One sheet with a few steps rather than a dropdown, so it is never clipped by
 * a small Chaos tile and works the same on a phone (bottom sheet) and a laptop
 * (centered card). Rules live on the server (moderation.ts); this only offers
 * what the server will accept.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ReportNoteMax,
  ReportReasons,
  type ReportReason,
  type SafetyAck,
} from "@karaoke/shared";
import type { SafetyApi } from "../rooms/useSafety.ts";

export const ReasonLabels: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  sexual: "Sexual content or nudity",
  hate: "Hate speech or slurs",
  violence: "Violence or threats",
  underage: "May be under 13",
  spam: "Spam or disrupting the room",
  other: "Something else",
};

/** What "remove" means for the viewer in this room. */
export type RemoveRule =
  | { kind: "host" }
  | { kind: "vote"; count: number; needed: number; voted: boolean; possible: boolean }
  | { kind: "none" };

/**
 * What leaving the 1v1 does right now: a forfeit (rated Ranked, being sung),
 * "scored" (results before settlement: not a forfeit, the match still counts
 * on the scores), or "free" (lobby, Duet, friendly rooms).
 */
export type LeaveEffect = "forfeit" | "scored" | "free";

type Step = "menu" | "report" | "block" | "remove" | "done";

export function SafetySheet({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, a, textarea")?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="safety-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div ref={ref} className="safety-sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function SafetyMenu({
  target,
  rule,
  oneOnOne,
  leaveEffect = "free",
  safety,
  onLeft,
  onToast,
}: {
  target: { id: string; name: string };
  rule: RemoveRule;
  /** Ranked/Duet: after a block or report, offer to leave the match. */
  oneOnOne: boolean;
  /**
   * What leaving does right now. Live from the room state, so the warning
   * follows the match as the sheet stays open.
   */
  leaveEffect?: LeaveEffect;
  safety: SafetyApi;
  onLeft: () => void;
  /** Echo results on the stage too: a Chaos block hides this tile (and its sheet) at once. */
  onToast?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SafetyAck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setStep("menu");
    setReason(null);
    setNote("");
    setAlsoBlock(true);
    setResult(null);
    setError(null);
  };

  const run = async (action: () => Promise<SafetyAck>) => {
    setBusy(true);
    setError(null);
    try {
      const ack = await action();
      if (!ack.ok) {
        setError(ack.message);
        return;
      }
      setResult(ack);
      setStep("done");
      onToast?.(ack.message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    const ack = await safety.leave();
    setBusy(false);
    if (ack.ok) {
      setOpen(false);
      onLeft();
    } else {
      setError(ack.message);
    }
  };

  const name = target.name || "this person";

  return (
    <>
      <button
        type="button"
        className="tile-menu-btn"
        aria-label={`Safety options for ${name}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">…</span>
      </button>

      {open ? (
        <SafetySheet label={`Safety options for ${name}`} onClose={close}>
          {step === "menu" ? (
            <>
              <p className="safety-kicker">Safety</p>
              <h2 className="safety-title">{name}</h2>
              <div className="safety-actions">
                <button type="button" className="safety-row" onClick={() => setStep("report")}>
                  <strong>Report</strong>
                  <span>Tell us what happened.</span>
                </button>
                <button
                  type="button"
                  className="safety-row"
                  disabled={safety.blocked.has(target.id)}
                  onClick={() => setStep("block")}
                >
                  <strong>{safety.blocked.has(target.id) ? "Blocked" : "Block"}</strong>
                  <span>Hide and mute them now. You won't be matched again.</span>
                </button>
                {rule.kind === "host" ? (
                  <button type="button" className="safety-row danger" onClick={() => setStep("remove")}>
                    <strong>Remove from room</strong>
                    <span>You're the host. They're disconnected and can't come back.</span>
                  </button>
                ) : null}
                {rule.kind === "vote" ? (
                  <button
                    type="button"
                    className="safety-row danger"
                    disabled={rule.voted || !rule.possible}
                    onClick={() => setStep("remove")}
                  >
                    <strong>
                      {rule.voted ? "You voted to remove" : "Vote to remove"}
                      {rule.count > 0 ? ` · ${rule.count}/${rule.needed}` : ""}
                    </strong>
                    <span>
                      {rule.possible
                        ? `Out once ${rule.needed} people here agree.`
                        : "Needs at least 3 people in the room. Block them instead."}
                    </span>
                  </button>
                ) : null}
              </div>
              {oneOnOne && rule.kind === "none" ? (
                <p className="safety-fine">
                  You can't remove someone from a 1v1. Block or report them and you can leave.
                  {leaveEffect === "forfeit"
                    ? " The match is on, so leaving now counts as a forfeit."
                    : leaveEffect === "scored"
                      ? " Both turns are sung, so the match is still scored as sung if you leave."
                      : " Leaving now doesn't change anyone's rating."}
                </p>
              ) : null}
              <div className="safety-foot">
                <button type="button" className="safety-ghost" onClick={close}>
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {step === "report" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason) return;
                void run(() =>
                  safety.report({
                    targetId: target.id,
                    reason,
                    note: note.trim() || undefined,
                    block: alsoBlock,
                  }),
                );
              }}
            >
              <p className="safety-kicker">Report</p>
              <h2 className="safety-title">What's going on with {name}?</h2>
              <div className="safety-reasons" role="radiogroup" aria-label="Reason">
                {ReportReasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={reason === r}
                    className={reason === r ? "safety-chip on" : "safety-chip"}
                    onClick={() => setReason(r)}
                  >
                    {ReasonLabels[r]}
                  </button>
                ))}
              </div>
              <label className="safety-note" htmlFor={noteId}>
                <span>
                  Add a note <em>(optional)</em>
                </span>
                <textarea
                  id={noteId}
                  value={note}
                  maxLength={ReportNoteMax}
                  rows={2}
                  placeholder="Anything that helps us understand"
                  onChange={(e) => setNote(e.target.value)}
                />
                <small>
                  {note.length}/{ReportNoteMax}
                </small>
              </label>
              <label className="safety-check">
                <input
                  type="checkbox"
                  checked={alsoBlock}
                  onChange={(e) => setAlsoBlock(e.target.checked)}
                />
                Also block {name}
              </label>
              {error ? <p className="safety-error">{error}</p> : null}
              <div className="safety-foot">
                <button type="button" className="safety-ghost" onClick={() => setStep("menu")}>
                  Back
                </button>
                <button type="submit" className="safety-primary" disabled={!reason || busy}>
                  {busy ? "Sending…" : "Send report"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "block" ? (
            <>
              <p className="safety-kicker">Block</p>
              <h2 className="safety-title">Block {name}?</h2>
              <p className="safety-body">
                You won't see or hear them from now on, and you'll never be matched with them
                again. They aren't told.
              </p>
              {error ? <p className="safety-error">{error}</p> : null}
              <div className="safety-foot">
                <button type="button" className="safety-ghost" onClick={() => setStep("menu")}>
                  Back
                </button>
                <button
                  type="button"
                  className="safety-primary danger"
                  disabled={busy}
                  onClick={() => void run(() => safety.block(target.id))}
                >
                  {busy ? "Blocking…" : "Block"}
                </button>
              </div>
            </>
          ) : null}

          {step === "remove" ? (
            <>
              <p className="safety-kicker">Remove</p>
              <h2 className="safety-title">
                {rule.kind === "host" ? `Remove ${name}?` : `Vote to remove ${name}?`}
              </h2>
              <p className="safety-body">
                {rule.kind === "host"
                  ? "They're disconnected right away and can't rejoin this room."
                  : rule.kind === "vote"
                    ? `They're removed once ${rule.needed} people here vote. Nobody sees who voted.`
                    : ""}
              </p>
              {error ? <p className="safety-error">{error}</p> : null}
              <div className="safety-foot">
                <button type="button" className="safety-ghost" onClick={() => setStep("menu")}>
                  Back
                </button>
                <button
                  type="button"
                  className="safety-primary danger"
                  disabled={busy}
                  onClick={() => void run(() => safety.kick(target.id))}
                >
                  {busy ? "Working…" : rule.kind === "host" ? "Remove" : "Vote to remove"}
                </button>
              </div>
            </>
          ) : null}

          {step === "done" && result ? (
            <>
              <p className="safety-kicker">Done</p>
              <h2 className="safety-title">{result.removed ? "Removed" : "Thanks"}</h2>
              <p className="safety-body">{result.message}</p>
              {oneOnOne && result.canLeave && leaveEffect === "forfeit" ? (
                <p className="safety-fine">
                  Your report is in either way. Leaving mid-match counts as a forfeit: it's
                  rated as a loss, like any other leave.
                </p>
              ) : null}
              {error ? <p className="safety-error">{error}</p> : null}
              <div className="safety-foot">
                {oneOnOne && result.canLeave ? (
                  <>
                    <button type="button" className="safety-ghost" onClick={close} disabled={busy}>
                      Stay
                    </button>
                    <button
                      type="button"
                      className="safety-primary"
                      disabled={busy}
                      onClick={() => void leave()}
                    >
                      {busy
                        ? "Leaving…"
                        : leaveEffect === "forfeit"
                          ? "Leave match · counts as a forfeit"
                          : leaveEffect === "scored"
                            ? "Leave match · result still counts"
                            : "Leave match · no rating change"}
                    </button>
                  </>
                ) : (
                  <button type="button" className="safety-primary" onClick={close}>
                    Done
                  </button>
                )}
              </div>
            </>
          ) : null}
        </SafetySheet>
      ) : null}
    </>
  );
}
