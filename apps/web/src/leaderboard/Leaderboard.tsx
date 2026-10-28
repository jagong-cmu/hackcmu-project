import { useEffect, useState } from "react";
import { songById } from "@karaoke/shared";
import { getDisplayName } from "../home/identity.ts";
import { Digits } from "../ui/Digits.tsx";
import "../home/pages.css";
import { PageShell } from "../theme/PageShell.tsx";

type RankedRow = { rank: number; displayName: string; elo: number; matchesPlayed: number };
type DuetRow = { rank: number; songId: string; names: [string, string]; score: number };

export function Leaderboard() {
  const [tab, setTab] = useState<"ranked" | "duet">("ranked");
  const [ranked, setRanked] = useState<RankedRow[]>([]);
  const [duet, setDuet] = useState<DuetRow[]>([]);
  const [mongo, setMongo] = useState(true);
  const me = getDisplayName().trim().toLowerCase();

  useEffect(() => {
    void Promise.all([
      fetch("/api/leaderboard/ranked").then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch("/api/leaderboard/duet").then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    ])
      .then(([a, b]) => {
        setMongo(Boolean(a.mongo && b.mongo));
        setRanked(a.rows ?? []);
        setDuet(b.rows ?? []);
      })
      .catch(() => {
        setMongo(false);
        setRanked([]);
        setDuet([]);
      });
  }, []);

  return (
    <PageShell title="Leaderboard" tag="Who’s been singing." wide quietWave className="pg-page">
      <div className="pg pg-wide">
        {!mongo ? <p className="dim">Leaderboard is unavailable right now.</p> : null}
        <div className="pg-tabs" role="tablist" aria-label="Leaderboard">
          {(["ranked", "duet"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className="t-tab"
              onClick={() => setTab(t)}
            >
              {t === "ranked" ? "Ranked ELO" : "Duet highs"}
            </button>
          ))}
        </div>
        <p className="dim">
          Casual ladder. Each singer’s browser scores their own take, so nothing here is verified.
        </p>
        {tab === "ranked" ? (
          <table className="pg-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>ELO</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dim">
                    No ranked matches yet.
                  </td>
                </tr>
              ) : (
                ranked.map((r) => (
                  <tr
                    key={`${r.rank}-${r.displayName}`}
                    className={me && r.displayName.trim().toLowerCase() === me ? "is-me" : undefined}
                  >
                    <td className={`pg-rank t-num${r.rank <= 3 ? " top" : ""}`}>
                      <Digits value={r.rank} />
                    </td>
                    <td className="pg-name">{r.displayName}</td>
                    <td className="t-num">
                      <Digits value={r.elo} />
                    </td>
                    <td className="dim">{r.matchesPlayed}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="pg-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Pair</th>
                <th>Song</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {duet.length === 0 ? (
                <tr>
                  <td colSpan={4} className="dim">
                    No duet scores yet.
                  </td>
                </tr>
              ) : (
                duet.map((r) => (
                  <tr
                    key={`${r.rank}-${r.names.join("-")}-${r.songId}`}
                    className={me && r.names.some((n) => n.trim().toLowerCase() === me) ? "is-me" : undefined}
                  >
                    <td className={`pg-rank t-num${r.rank <= 3 ? " top" : ""}`}>
                      <Digits value={r.rank} />
                    </td>
                    <td className="pg-name">{r.names.join(" + ")}</td>
                    <td>{songById(r.songId)?.title ?? r.songId}</td>
                    <td className="t-num">
                      <Digits value={r.score} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
