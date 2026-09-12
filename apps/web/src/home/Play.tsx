import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DemoRoomCode } from "@karaoke/shared";
import { getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";

const COPY: Record<string, { title: string; blurb: string }> = {
  ranked: { title: "Ranked", blurb: "Same 15s chorus. A then B. ELO." },
  duet: { title: "Duet", blurb: "Sing together. Shared score. No ELO." },
  chaos: { title: "Chaos", blurb: "Lounge. Join mid-song. No score." },
};

export function Play() {
  const { mode = "ranked" } = useParams();
  const [code, setCode] = useState("");
  const named = validName(getDisplayName());
  const info = COPY[mode] ?? COPY.ranked;
  const { queueJoin, roomJoin, chaosJoin, hello, connected, error } = useRoom();

  function parseCode(raw: string): string | null {
    const c = raw.replace(/\D/g, "").slice(0, 4);
    return c.length === 4 ? c : null;
  }

  function announce() {
    if (named) hello(getDisplayName());
  }

  return (
    <main className="page quiet">
      <Link to="/" className="back">
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

      {mode === "chaos" ? (
        <div className="stack-actions">
          <button
            type="button"
            className="btn gold"
            disabled={!named || !connected}
            onClick={() => {
              announce();
              chaosJoin();
            }}
          >
            Join lounge
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = parseCode(code);
              if (c) {
                announce();
                chaosJoin(c);
              }
            }}
          >
            <input
              inputMode="numeric"
              maxLength={4}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              aria-label="Room code"
            />
            <button type="submit" className="btn ghost" disabled={!named || !connected}>
              Enter code
            </button>
          </form>
        </div>
      ) : (
        <div className="stack-actions">
          <button
            type="button"
            className="btn gold"
            disabled={!named || !connected}
            onClick={() => {
              announce();
              queueJoin(mode === "duet" ? "duet" : "ranked");
            }}
          >
            Random
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = parseCode(code);
              if (!c) return;
              announce();
              roomJoin(c);
            }}
          >
            <input
              inputMode="numeric"
              maxLength={4}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              aria-label="Room code"
            />
            <button type="submit" className="btn ghost" disabled={!named || !connected}>
              Enter code
            </button>
          </form>
          <button
            type="button"
            className="btn ghost"
            disabled={!named || !connected}
            onClick={() => {
              announce();
              roomJoin(DemoRoomCode);
            }}
          >
            Join {DemoRoomCode}
          </button>
        </div>
      )}
    </main>
  );
}
