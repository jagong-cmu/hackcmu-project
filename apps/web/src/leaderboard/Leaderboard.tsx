import { useEffect, useState } from "react";
import { songById } from "@karaoke/shared";
import { PageShell } from "../theme/PageShell.tsx";

type RankedRow = { rank: number; displayName: string; elo: number; matchesPlayed: number };
type DuetRow = { rank: number; songId: string; names: [string, string]; score: number };

export function Leaderboard() {
  const [tab, setTab] = useState<"ranked" | "duet">("ranked");
  const [ranked, setRanked] = useState<RankedRow[]>([]);
  const [duet, setDuet] = useState<DuetRow[]>([]);
  const [mongo, setMongo] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/leaderboard/ranked").then((r) => r.json()),
      fetch("/api/leaderboard/duet").then((r) => r.json()),
    ]).then(([a, b]) => {
      setMongo(Boolean(a.mongo && b.mongo));
      setRanked(a.rows ?? []);
      setDuet(b.rows ?? []);
    });
  }, []);

  return (
    <PageShell title="Leaderboard" tag="Who’s been singing." wide quietWave>
      {!mongo ? <p className="dim">Leaderboard is unavailable right now.</p> : null}
      <div className="tabs">
        <button type="button" className={tab === "ranked" ? "on" : ""} onClick={() => setTab("ranked")}>
          Ranked ELO
        </button>
        <button type="button" className={tab === "duet" ? "on" : ""} onClick={() => setTab("duet")}>
          Duet highs
        </button>
      </div>
      {tab === "ranked" ? (
        <table className="board">
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
                <tr key={`${r.rank}-${r.displayName}`}>
                  <td>{r.rank}</td>
                  <td>{r.displayName}</td>
                  <td>{r.elo}</td>
                  <td>{r.matchesPlayed}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : (
        <table className="board">
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
                <tr key={`${r.rank}-${r.names.join("-")}-${r.songId}`}>
                  <td>{r.rank}</td>
                  <td>{r.names.join(" + ")}</td>
                  <td>{songById(r.songId)?.title ?? r.songId}</td>
                  <td>{r.score}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </PageShell>
  );
}
