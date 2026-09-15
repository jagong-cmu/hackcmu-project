/**
 * First-party arena counters (Atlas) plus PostHog Cloud.
 *
 * Mongo is the local scoreboard (matches, songs, training). PostHog is the
 * product-analytics dashboard. Both no-op when unconfigured so a missing key
 * never breaks a match. Session replay stays off — the stage has cameras.
 */
import { PostHog } from "posthog-node";
import { songById } from "@karaoke/shared";
import { getDb, matches, players } from "./db.ts";

const TOTALS_ID = "totals" as const;

export type ArenaCounters = {
  _id: typeof TOTALS_ID;
  matchesRanked: number;
  matchesDuet: number;
  matchesForfeit: number;
  songsPlayed: number;
  songsById: Record<string, number>;
  trainingSessions: number;
  chaosJoins: number;
  roomsCreated: number;
  queueJoins: number;
  scoresSubmitted: number;
  updatedAt: Date;
};

export type ArenaStats = {
  ok: true;
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

type StatKey = Exclude<keyof ArenaCounters, "_id" | "songsById" | "updatedAt">;

const EMPTY_TOTALS: ArenaStats["totals"] = {
  matchesRanked: 0,
  matchesDuet: 0,
  matchesForfeit: 0,
  songsPlayed: 0,
  trainingSessions: 0,
  chaosJoins: 0,
  roomsCreated: 0,
  queueJoins: 0,
  scoresSubmitted: 0,
  players: 0,
};

let posthog: PostHog | null = null;
let posthogTried = false;

export function posthogConfigured(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY?.trim() || process.env.VITE_PUBLIC_POSTHOG_KEY?.trim());
}

function posthogClient(): PostHog | null {
  if (posthogTried) return posthog;
  posthogTried = true;
  const key = process.env.POSTHOG_API_KEY?.trim() || process.env.VITE_PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return null;
  const host = process.env.POSTHOG_HOST?.trim() || process.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  const serverless = Boolean(process.env.VERCEL);
  try {
    posthog = new PostHog(key, {
      host,
      flushAt: serverless ? 1 : 10,
      flushInterval: serverless ? 0 : 10_000,
    });
  } catch (err) {
    console.error("[analytics] posthog init failed", err);
    posthog = null;
  }
  return posthog;
}

function flushSoon(client: PostHog): void {
  if (process.env.VERCEL) void client.flush();
}

export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const client = posthogClient();
  if (!client) return;
  try {
    client.capture({
      distinctId: distinctId || "arena",
      event,
      properties: { source: "server", ...properties },
    });
    flushSoon(client);
  } catch (err) {
    console.error("[analytics] posthog capture failed", err);
  }
}

function songField(songId: string): string {
  return songId.replace(/[.$]/g, "_").slice(0, 64) || "unknown";
}

export async function bumpStats(
  inc: Partial<Record<StatKey, number>>,
  songId?: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const $inc: Record<string, number> = {};
  for (const [key, value] of Object.entries(inc)) {
    if (typeof value === "number" && value !== 0) $inc[key] = value;
  }
  if (songId) {
    $inc.songsPlayed = ($inc.songsPlayed ?? 0) + 1;
    $inc[`songsById.${songField(songId)}`] = 1;
  }
  if (Object.keys($inc).length === 0) return;
  try {
    await db.collection<ArenaCounters>("arenaStats").updateOne(
      { _id: TOTALS_ID },
      { $inc, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    console.error("[analytics] bump failed", err);
  }
}

export async function trackMatchStarted(input: {
  mode: string;
  songId: string | null;
  roomCode: string;
  distinctId?: string;
}): Promise<void> {
  await bumpStats({}, input.songId);
  captureEvent(input.distinctId ?? "arena", "match started", {
    mode: input.mode,
    song_id: input.songId,
    room_code: input.roomCode,
  });
}

export async function trackSongPlayed(input: {
  mode: string;
  songId: string | null;
  roomCode: string;
  distinctId?: string;
}): Promise<void> {
  if (input.mode === "chaos") await bumpStats({}, input.songId);
  captureEvent(input.distinctId ?? "arena", "song played", {
    mode: input.mode,
    song_id: input.songId,
    room_code: input.roomCode,
  });
}

export async function trackMatchCompleted(input: {
  mode: string;
  songId: string | null;
  roomCode: string;
  forfeit?: boolean;
  distinctId?: string;
}): Promise<void> {
  const inc: Partial<Record<StatKey, number>> = {};
  if (input.mode === "ranked") inc.matchesRanked = 1;
  else if (input.mode === "duet") inc.matchesDuet = 1;
  if (input.forfeit) inc.matchesForfeit = 1;
  await bumpStats(inc);
  captureEvent(input.distinctId ?? "arena", "match completed", {
    mode: input.mode,
    song_id: input.songId,
    room_code: input.roomCode,
    forfeit: Boolean(input.forfeit),
  });
}

export async function trackTrainingCompleted(input: {
  songId?: string;
  distinctId: string;
  overall?: number;
}): Promise<void> {
  await bumpStats({ trainingSessions: 1, scoresSubmitted: 1 }, input.songId);
  captureEvent(input.distinctId, "training completed", {
    mode: "training",
    song_id: input.songId,
    overall: input.overall,
  });
}

export async function trackScoreSubmitted(input: { distinctId: string; roomCode: string }): Promise<void> {
  await bumpStats({ scoresSubmitted: 1 });
  captureEvent(input.distinctId, "score submitted", { room_code: input.roomCode });
}

export async function trackQueueJoined(input: { mode: string; distinctId: string }): Promise<void> {
  await bumpStats({ queueJoins: 1 });
  captureEvent(input.distinctId, "queue joined", { mode: input.mode });
}

export async function trackRoomCreated(input: { mode: string; roomCode: string; distinctId: string }): Promise<void> {
  await bumpStats({ roomsCreated: 1 });
  captureEvent(input.distinctId, "room created", {
    mode: input.mode,
    room_code: input.roomCode,
  });
}

export async function trackChaosJoined(input: { roomCode: string; distinctId: string }): Promise<void> {
  await bumpStats({ chaosJoins: 1 });
  captureEvent(input.distinctId, "chaos joined", { room_code: input.roomCode });
}

export async function getArenaStats(): Promise<ArenaStats> {
  const empty: ArenaStats = {
    ok: true,
    mongo: false,
    posthog: posthogConfigured(),
    totals: { ...EMPTY_TOTALS },
    songs: [],
  };
  const db = await getDb();
  if (!db) return empty;

  try {
    const [counters, ranked, duet, forfeits, playerCount] = await Promise.all([
      db.collection<ArenaCounters>("arenaStats").findOne({ _id: TOTALS_ID }),
      matches(db).countDocuments({ mode: "ranked" }),
      matches(db).countDocuments({ mode: "duet" }),
      matches(db).countDocuments({ forfeit: true }),
      players(db).countDocuments(),
    ]);

    const fromMatches = new Map<string, number>();
    const grouped = await matches(db)
      .aggregate<{ _id: string; plays: number }>([{ $group: { _id: "$songId", plays: { $sum: 1 } } }])
      .toArray();
    for (const row of grouped) {
      if (row._id) fromMatches.set(songField(row._id), row.plays);
    }

    const songsById = { ...(counters?.songsById ?? {}) };
    for (const [id, plays] of fromMatches) {
      songsById[id] = Math.max(songsById[id] ?? 0, plays);
    }

    const songPlays = Object.values(songsById).reduce((sum, n) => sum + n, 0);
    const songs = Object.entries(songsById)
      .map(([id, plays]) => {
        const meta = songById(id);
        return {
          id,
          title: meta?.title ?? id,
          artist: meta?.artist ?? "",
          plays,
        };
      })
      .sort((a, b) => b.plays - a.plays);

    return {
      ok: true,
      mongo: true,
      posthog: posthogConfigured(),
      totals: {
        matchesRanked: Math.max(counters?.matchesRanked ?? 0, ranked),
        matchesDuet: Math.max(counters?.matchesDuet ?? 0, duet),
        matchesForfeit: Math.max(counters?.matchesForfeit ?? 0, forfeits),
        songsPlayed: Math.max(counters?.songsPlayed ?? 0, songPlays, ranked + duet),
        trainingSessions: counters?.trainingSessions ?? 0,
        chaosJoins: counters?.chaosJoins ?? 0,
        roomsCreated: counters?.roomsCreated ?? 0,
        queueJoins: counters?.queueJoins ?? 0,
        scoresSubmitted: counters?.scoresSubmitted ?? 0,
        players: playerCount,
      },
      songs,
    };
  } catch (err) {
    console.error("[analytics] stats read failed", err);
    return empty;
  }
}
