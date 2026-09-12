import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DemoRoomCode } from "@karaoke/shared";
import { getClientId, getDisplayName, validName } from "./identity.ts";
import { laneA } from "./laneA.ts";

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

  function parseCode(raw: string): string | null {
    const c = raw.replace(/\D/g, "").slice(0, 4);
    return c.length === 4 ? c : null;
  }

  function go(fn: () => void) {
    if (!named) return;
    void fetch("/api/player/hello", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: getClientId(), displayName: getDisplayName() }),
    }).catch(() => undefined);
    fn();
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

      {mode === "chaos" ? (
        <div className="stack-actions">
          <button type="button" className="btn gold" disabled={!named} onClick={() => go(laneA.chaosLounge)}>
            Join lounge
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = parseCode(code);
              if (c) go(() => laneA.chaosCode(c));
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
            <button type="submit" className="btn ghost" disabled={!named}>
              Enter code
            </button>
          </form>
        </div>
      ) : (
        <div className="stack-actions">
          <button
            type="button"
            className="btn gold"
            disabled={!named}
            onClick={() => go(mode === "duet" ? laneA.duetRandom : laneA.rankedRandom)}
          >
            Random
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = parseCode(code);
              if (!c) return;
              go(() => (mode === "duet" ? laneA.duetCode(c) : laneA.rankedCode(c)));
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
            <button type="submit" className="btn ghost" disabled={!named}>
              Enter code
            </button>
          </form>
          <button
            type="button"
            className="btn ghost"
            disabled={!named}
            onClick={() => go(mode === "duet" ? laneA.duet0000 : laneA.ranked0000)}
          >
            Join {DemoRoomCode}
          </button>
        </div>
      )}
    </main>
  );
}
