import { useEffect, useState } from "react";
import { PageShell } from "../theme/PageShell.tsx";

type ArenaStats = {
  ok: boolean;
  mongo: boolean;
  posthog: boolean;
  totals: {
    matchesRanked: number;
    matchesDuet: number;
    matchesForfeit: number;
    songsPlayed: number;
    trainingSessions: number;
    chaosJoins: number;
    roomsCreated: number;
    queueJoins: number;
    scoresSubmitted: number;
    players: number;
  };
  songs: Array<{ id: string; title: string; artist: string; plays: number }>;
};

const TILES: Array<{ key: keyof ArenaStats["totals"]; label: string }> = [
  { key: "matchesRanked", label: "Ranked matches" },
  { key: "matchesDuet", label: "Duets" },
  { key: "songsPlayed", label: "Songs played" },
  { key: "trainingSessions", label: "Training runs" },
  { key: "players", label: "Singers" },
  { key: "chaosJoins", label: "Chaos joins" },
  { key: "roomsCreated", label: "Rooms created" },
  { key: "queueJoins", label: "Queue joins" },
];

export function ArenaStats() {
  const [stats, setStats] = useState<ArenaStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void fetch("/api/stats")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ArenaStats>;
      })
      .then((body) => {
        setStats(body);
        setError(false);
      })
      .catch(() => {
        setError(true);
        setStats(null);
      });
  }, []);

  const totals = stats?.totals;
  const songs = stats?.songs ?? [];

  return (
    <PageShell title="Arena" tag="How busy the room has been." wide quietWave>
      {error ? <p className="dim">Stats are unavailable right now.</p> : null}
      {!error && !stats ? <p className="dim">Counting…</p> : null}
      {totals ? (
        <>
          <div className="stat-grid">
            {TILES.map((tile) => (
              <div className="stat-tile" key={tile.key}>
                <strong>{totals[tile.key]}</strong>
                <span>{tile.label}</span>
              </div>
            ))}
          </div>
          {totals.matchesForfeit > 0 || totals.scoresSubmitted > 0 ? (
            <p className="dim">
              {totals.scoresSubmitted} {totals.scoresSubmitted === 1 ? "score" : "scores"} posted
              {totals.matchesForfeit > 0
                ? ` · ${totals.matchesForfeit} ${totals.matchesForfeit === 1 ? "forfeit" : "forfeits"}`
                : ""}
              .
            </p>
          ) : null}
          {!stats?.mongo ? (
            <p className="dim">Mongo is off, so these numbers reset when the server sleeps.</p>
          ) : null}
          <p className="dim">
            {stats?.posthog
              ? "Pageviews and funnels also go to PostHog."
              : "PostHog is not configured, so website traffic is only counted here."}
          </p>
        </>
      ) : null}

      <h2 className="stat-songs-title">Songs</h2>
      <table className="board">
        <thead>
          <tr>
            <th>Song</th>
            <th>Artist</th>
            <th>Plays</th>
          </tr>
        </thead>
        <tbody>
          {songs.length === 0 ? (
            <tr>
              <td colSpan={3} className="dim">
                No songs counted yet.
              </td>
            </tr>
          ) : (
            songs.map((song) => (
              <tr key={song.id}>
                <td>{song.title}</td>
                <td>{song.artist || "—"}</td>
                <td>{song.plays}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </PageShell>
  );
}
