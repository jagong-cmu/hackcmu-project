import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DemoRoomCode, type Mode } from "@karaoke/shared";
import { getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";

const COPY: Record<string, { title: string; blurb: string }> = {
  ranked: { title: "Ranked", blurb: "Same 15s chorus. A then B. ELO." },
  duet: { title: "Duet", blurb: "Sing together. Shared score. No ELO." },
  chaos: { title: "Chaos", blurb: "Join a lounge. Cameras and lyrics. No score." },
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
    <main className="page bloom-page quiet play-page">
      <div className="bloom" aria-hidden="true">
        <div className="bloom-core" />
      </div>
      <Link
        to="/"
        className="back"
        onClick={() => {
          if (inQueue) queueLeave();
        }}
      >
        Home
      </Link>
      <h1>{info.title}</h1>
      <p className="tag">{info.blurb}</p>
      {!named ? (
        <p>
          <Link to={`/settings?next=/play/${mode}`}>Set your name</Link> first.
        </p>
      ) : null}
      {!connected ? <p className="dim">Connecting…</p> : null}
      {error ? (
        <p className="err">
          {error.code}: {error.message}
        </p>
      ) : null}

      {inQueue ? (
        <div className="play-choices">
          <section className="play-choice">
            <h2>In the random queue</h2>
            <p>
              Waiting for the next person who joins the {info.title.toLowerCase()} queue.
              You will be paired automatically.
            </p>
            <button type="button" className="btn ghost" onClick={queueLeave}>
              Leave queue
            </button>
          </section>
        </div>
      ) : (
        <div className="play-choices">
          <section className="play-choice">
            <h2>{isChaos ? "Public lounge" : "Random queue"}</h2>
            <p>
              {isChaos
                ? "Jump in. You'll be seated automatically. When a lounge fills up, a new one opens."
                : "Get paired with the next player waiting in this mode."}
            </p>
            <button
              type="button"
              className="btn gold"
              disabled={!named || !connected}
              onClick={() => {
                announce();
                if (isChaos) chaosJoin();
                else queueJoin(playMode);
              }}
            >
              {isChaos ? "Join queue" : "Join random queue"}
            </button>
          </section>

          <section className="play-choice">
            <h2>Private room</h2>
            <p>
              {isChaos
                ? "Create a 4-digit code and send it to a friend, or join one they already made. Same lounge rules, just not the public queue."
                : "Create a 4-digit code and send it to a friend, or join one they already made."}
            </p>
            <button
              type="button"
              className="btn gold"
              disabled={!named || !connected}
              onClick={() => {
                announce();
                roomCreate(playMode);
              }}
            >
              Create private room
            </button>
            <form
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
                placeholder="4-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-label="Room code"
              />
              <button type="submit" className="btn ghost" disabled={!named || !connected}>
                Join with code
              </button>
            </form>
            {mode === "ranked" ? (
              <button
                type="button"
                className="text-btn demo-code"
                disabled={!named || !connected}
                onClick={() => {
                  announce();
                  roomJoin(DemoRoomCode);
                }}
              >
                Or join the public demo room {DemoRoomCode}
              </button>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}
