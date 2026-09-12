import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DemoRoomCode, type Mode } from "@karaoke/shared";
import { getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { PageShell } from "../theme/PageShell.tsx";

const COPY: Record<string, { title: string; blurb: string; match: string; matchBtn: string }> = {
  ranked: {
    title: "Ranked",
    blurb: "From the top through the first chorus. You then them. Winner takes ELO.",
    match: "We’ll pair you with the next singer waiting in Ranked.",
    matchBtn: "Find a match",
  },
  duet: {
    title: "Duet",
    blurb: "Sing the whole song together. One shared score. No ELO.",
    match: "We’ll pair you with the next singer waiting for a duet.",
    matchBtn: "Find a partner",
  },
  chaos: {
    title: "Chaos",
    blurb: "Walk into a lounge. Cameras and lyrics. No score.",
    match: "Jump in. You’ll be seated automatically. When a lounge fills, a new one opens.",
    matchBtn: "Join a lounge",
  },
};

function playModeOf(mode: string): Mode {
  if (mode === "duet" || mode === "chaos") return mode;
  return "ranked";
}

export function Play() {
  const { mode = "ranked" } = useParams();
  const [code, setCode] = useState("");
  const named = validName(getDisplayName());
  const info = COPY[mode] ?? COPY.ranked;
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
  const inQueue = !isChaos && queuedMode === playMode;

  function parseCode(raw: string): string | null {
    const c = raw.replace(/\D/g, "").slice(0, 4);
    return c.length === 4 ? c : null;
  }

  function announce() {
    if (named) hello(getDisplayName());
  }

  return (
    <PageShell
      title={info.title}
      tag={info.blurb}
      wide
      className="play-page"
      onHome={() => {
        if (inQueue) queueLeave();
        roomLeave();
      }}
    >
      {!named ? (
        <p>
          <Link to={`/settings?next=/play/${mode}`}>Set your name</Link> first.
        </p>
      ) : null}
      {!connected ? <p className="dim">Connecting…</p> : null}
      {error ? (
        <p className="err">{error.message}</p>
      ) : null}

      {inQueue ? (
        <div className="play-choices">
          <section className="card play-choice play-waiting">
            <h2>Looking for a singer</h2>
            <p>
              {connected
                ? `Stay here. The next person who taps “${info.matchBtn}” is your match.`
                : "Reconnecting — you’ll be put back in the queue automatically."}
            </p>
            <button type="button" className="cta cta-ghost" onClick={queueLeave}>
              Leave queue
            </button>
          </section>
        </div>
      ) : (
        <div className="play-choices">
          <section className="card play-choice">
            <h2>{isChaos ? "Public lounge" : "Random match"}</h2>
            <p>{info.match}</p>
            <button
              type="button"
              className="cta"
              disabled={!named || !connected}
              onClick={() => {
                announce();
                if (isChaos) chaosJoin();
                else queueJoin(playMode);
              }}
            >
              {info.matchBtn}
            </button>
          </section>

          <section className="card play-choice">
            <h2>{isChaos ? "Private lounge" : "Sing with a friend"}</h2>
            <p>
              {isChaos
                ? "Make a 4-digit code and send it, or join one a friend already made."
                : "Create a room and send the code, or type theirs below."}
            </p>
            <button
              type="button"
              className="cta cta-ghost"
              disabled={!named || !connected}
              onClick={() => {
                announce();
                roomCreate(playMode);
              }}
            >
              Create a room
            </button>
            <form
              className="code-form"
              onSubmit={(e) => {
                e.preventDefault();
                const c = parseCode(code);
                if (!c) return;
                announce();
                if (isChaos) chaosJoin(c);
                else roomJoin(c);
              }}
            >
              <input
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-label="Room code"
              />
              <button type="submit" className="cta" disabled={!named || !connected || code.length !== 4}>
                Join
              </button>
            </form>
            {mode === "ranked" ? (
              <button
                type="button"
                className="play-hint"
                disabled={!named || !connected}
                onClick={() => {
                  announce();
                  roomJoin(DemoRoomCode);
                }}
              >
                Or jump into the public demo room {DemoRoomCode}
              </button>
            ) : null}
          </section>
        </div>
      )}
    </PageShell>
  );
}
