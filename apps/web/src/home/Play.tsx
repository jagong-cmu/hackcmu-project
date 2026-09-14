import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type Mode } from "@karaoke/shared";
import { getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { PageShell } from "../theme/PageShell.tsx";

const COPY: Record<
  string,
  {
    title: string;
    blurb: string;
    create: string;
    join: string;
  }
> = {
  ranked: {
    title: "Ranked",
    blurb: "Same 20-second chorus. You then them. Winner takes ELO.",
    create: "Start a private match and send the 4-digit code to a friend.",
    join: "Type the code your friend sent you.",
  },
  duet: {
    title: "Duet",
    blurb: "Sing the whole song together. One shared score. No ELO.",
    create: "Start a private duet and send the 4-digit code to a friend.",
    join: "Type the code your friend sent you.",
  },
  chaos: {
    title: "Chaos",
    blurb: "Walk into a lounge. Cameras and lyrics. No score.",
    create: "Make a private lounge and send the 4-digit code to a friend.",
    join: "Type the lounge code your friend sent you.",
  },
};

function playModeOf(mode: string): Mode {
  if (mode === "duet" || mode === "chaos") return mode;
  return "ranked";
}

export function Play() {
  const { mode = "ranked" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
  const autoQueue = params.get("go") === "1" && !isChaos;

  useEffect(() => {
    if (!autoQueue || !named || !connected || inQueue) return;
    hello(getDisplayName());
    queueJoin(playMode);
  }, [autoQueue, named, connected, inQueue, playMode, hello, queueJoin]);

  function parseCode(raw: string): string | null {
    const c = raw.replace(/\D/g, "").slice(0, 4);
    return c.length === 4 ? c : null;
  }

  function announce() {
    if (named) hello(getDisplayName());
  }

  function stopQueue() {
    queueLeave();
    navigate("/");
  }

  function joinRoom(raw: string) {
    const c = parseCode(raw);
    if (!c) return;
    announce();
    if (isChaos) chaosJoin(c);
    else roomJoin(c);
  }

  const waiting = inQueue || autoQueue;

  return (
    <PageShell
      title={info.title}
      tag={info.blurb}
      wide
      className="play-page"
      onHome={() => {
        if (inQueue || autoQueue) queueLeave();
        roomLeave();
      }}
    >
      {!named ? (
        <p>
          <Link to={`/settings?next=/play/${mode}`}>Set your name</Link> first.
        </p>
      ) : null}
      {!connected && !waiting ? <p className="dim">Connecting…</p> : null}
      {error ? (
        <p className="err">{error.message}</p>
      ) : null}

      {waiting ? (
        <div className="play-choices">
          <section className="card play-choice play-waiting">
            <h2>Looking for a singer</h2>
            <p>
              {connected
                ? "Stay here. The next person who taps Play is your match."
                : "Connecting — you’ll be put in the queue automatically."}
            </p>
            <button type="button" className="cta cta-ghost" onClick={stopQueue}>
              Leave queue
            </button>
          </section>
        </div>
      ) : (
        <div className="play-choices">
          <section className="card play-choice">
            <h2>Create a room</h2>
            <p>{info.create}</p>
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
            <p>{info.join}</p>
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
      )}
    </PageShell>
  );
}
