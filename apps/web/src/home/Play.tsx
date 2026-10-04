import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type Mode } from "@karaoke/shared";
import { getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { PageShell } from "../theme/PageShell.tsx";

type PlayMode = Extract<Mode, "ranked" | "duet" | "chaos">;

const PRIVATE_MODES: { mode: PlayMode; label: string; blurb: string }[] = [
  { mode: "ranked", label: "Ranked", blurb: "Same 20-second chorus. You then them. Winner takes ELO." },
  { mode: "duet", label: "Duet", blurb: "Sing the whole song together. One shared score. No ELO." },
  { mode: "chaos", label: "Chaos", blurb: "A lounge for your crew. Cameras and lyrics. No score." },
];

/**
 * Matchmaking copy for each mode's Home button (`?go=1`). Every mode matches
 * only with players who picked the same mode: Ranked and Duet each have their
 * own server queue, and Chaos fills public Chaos lounges.
 */
const QUEUE_COPY: Record<PlayMode, { title: string; tag: string; waiting: string; hint: string }> = {
  ranked: {
    title: "Ranked",
    tag: "Same 20-second chorus. You then them. Winner takes ELO.",
    waiting: "Looking for a singer",
    hint: "Stay here. The next person who taps Play is your match.",
  },
  duet: {
    title: "Duet",
    tag: "Sing the whole song together. One shared score. No ELO.",
    waiting: "Looking for a duet partner",
    hint: "Stay here. The next person who picks Duet sings with you.",
  },
  chaos: {
    title: "Chaos",
    tag: "Walk into a lounge. Cameras and lyrics. No score.",
    waiting: "Finding a lounge",
    hint: "Hang on. We’re dropping you into an open Chaos lounge.",
  },
};

function playModeOf(mode: string): PlayMode {
  if (mode === "duet" || mode === "chaos") return mode;
  return "ranked";
}

export function Play() {
  const { mode = "ranked" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const named = validName(getDisplayName());
  const {
    queueJoin,
    queueLeave,
    queuedMode,
    roomCreate,
    roomJoin,
    chaosJoin,
    hello,
    connected,
    error,
    roomLeave,
  } = useRoom();

  const playMode = playModeOf(mode);
  const isChaos = playMode === "chaos";
  // `?go=1` is matchmaking for this mode; without it the page is a private room.
  const matchmaking = params.get("go") === "1";
  const inQueue = !isChaos && queuedMode === playMode;
  const chaosAsked = useRef(false);

  useEffect(() => {
    if (!matchmaking || !named || !connected) return;
    if (isChaos) {
      if (chaosAsked.current) return;
      chaosAsked.current = true;
      hello(getDisplayName());
      chaosJoin();
    } else if (!inQueue) {
      hello(getDisplayName());
      queueJoin(playMode);
    }
  }, [matchmaking, named, connected, inQueue, isChaos, playMode, hello, queueJoin, chaosJoin]);

  function announce() {
    if (named) hello(getDisplayName());
  }

  function leave() {
    if (isChaos) roomLeave();
    else queueLeave();
    navigate("/play");
  }

  function joinRoom(raw: string) {
    const c = raw.replace(/\D/g, "").slice(0, 4);
    if (c.length !== 4) return;
    announce();
    // The code decides the mode, so any private room joins the same way.
    roomJoin(c);
  }

  const back = `/play/${mode}${matchmaking ? "?go=1" : ""}`;
  const notices = (
    <>
      {!named ? (
        <p>
          <Link to={`/settings?next=${encodeURIComponent(back)}`}>Set your name</Link> first.
        </p>
      ) : null}
      {error ? <p className="err">{error.message}</p> : null}
    </>
  );

  if (matchmaking) {
    const copy = QUEUE_COPY[playMode];
    return (
      <PageShell
        title={copy.title}
        tag={copy.tag}
        wide
        className="play-page"
        onHome={() => {
          queueLeave();
          roomLeave();
        }}
      >
        {notices}
        <div className="play-choices">
          <section className="card play-choice play-waiting">
            <h2>{copy.waiting}</h2>
            <p>{connected ? copy.hint : "Connecting — you’ll be matched automatically."}</p>
            <button type="button" className="cta cta-ghost" onClick={leave}>
              {isChaos ? "Cancel" : "Leave queue"}
            </button>
          </section>
        </div>
      </PageShell>
    );
  }

  const selected = PRIVATE_MODES.find((m) => m.mode === playMode) ?? PRIVATE_MODES[0];
  return (
    <PageShell
      title="Private room"
      tag="Pick a mode, then send the 4-digit code to a friend."
      wide
      className="play-page"
      onHome={() => roomLeave()}
    >
      {notices}
      {!connected ? <p className="dim">Connecting…</p> : null}

      <div className="mode-pick" role="radiogroup" aria-label="Room mode">
        {PRIVATE_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={m.mode === playMode}
            className={m.mode === playMode ? "on" : undefined}
            onClick={() => navigate(`/play/${m.mode}`, { replace: true })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mode-pick-blurb">{selected.blurb}</p>

      <div className="play-choices">
        <section className="card play-choice">
          <h2>Create a room</h2>
          <p>Start a private {selected.label.toLowerCase()} room and share its code.</p>
          <button
            type="button"
            className="cta"
            disabled={!named || !connected}
            onClick={() => {
              announce();
              roomCreate(playMode);
            }}
          >
            Create a room
          </button>
        </section>

        <section className="card play-choice">
          <h2>Join a room</h2>
          <p>Type the code your friend sent you.</p>
          <form
            className="code-form"
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom(code);
            }}
          >
            <input
              inputMode="numeric"
              maxLength={4}
              placeholder="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              aria-label="Room code"
            />
            <button type="submit" className="cta" disabled={!named || !connected || code.length !== 4}>
              Join
            </button>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
