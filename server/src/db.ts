/**
 * Atlas M0, database name karaoke-arena. No paid tier.
 *
 * Create a free cluster (no card): https://cloud.mongodb.com
 * Database user + Network Access 0.0.0.0/0 for the hackathon.
 * Put the SRV URI in server/.env as MONGODB_URI.
 * Example: mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/karaoke-arena?retryWrites=true&w=majority
 */
import { MongoClient, type Collection, type Db } from "mongodb";
import { StartingElo } from "../../packages/shared/src/index.ts";

const DB_NAME = "karaoke-arena";

export type PlayerDoc = {
  clientId: string;
  displayName: string;
  elo: number;
  matchesPlayed: number;
  updatedAt: Date;
};

export type MatchDoc = {
  roomId: string;
  mode: "ranked" | "duet";
  songId: string;
  a: { clientId: string; displayName: string; score: unknown; elo?: number };
  b: { clientId: string; displayName: string; score: unknown; elo?: number };
  winnerId: string | "draw" | null;
  eloDelta: { a: number; b: number } | null;
  forfeit?: boolean;
  createdAt: Date;
};

export type DuetScoreDoc = {
  songId: string;
  names: [string, string];
  score: number;
  createdAt: Date;
  updatedAt: Date;
};

let client: MongoClient | null = null;
let connecting: Promise<Db | null> | null = null;

export function mongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export async function getDb(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return null;
  if (client) return client.db(DB_NAME);
  if (!connecting) {
    connecting = (async () => {
      const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await c.connect();
      client = c;
      const db = c.db(DB_NAME);
      await ensureIndexes(db);
      return db;
    })().catch((err) => {
      connecting = null;
      console.error("[db] Atlas connect failed", err);
      return null;
    });
  }
  return connecting;
}

async function ensureIndexes(db: Db): Promise<void> {
  await players(db).createIndex({ clientId: 1 }, { unique: true });
  await matches(db).createIndex({ createdAt: -1 });
  await matches(db).createIndex({ roomId: 1 });
  await duetScores(db).createIndex({ songId: 1, names: 1 }, { unique: true });
  await duetScores(db).createIndex({ score: -1 });
  await db.collection("queueWaiters").createIndex({ clientId: 1 }, { unique: true });
  await db.collection("queueWaiters").createIndex({ mode: 1, updatedAt: -1 });
  await db.collection("queueWaiters").createIndex({ updatedAt: 1 }, { expireAfterSeconds: 20 });
  await db.collection("queuePairs").createIndex({ createdAt: 1 }, { expireAfterSeconds: 180 });
  await db.collection("queuePairs").createIndex({ "a.clientId": 1, mode: 1 });
  await db.collection("queuePairs").createIndex({ "b.clientId": 1, mode: 1 });
  await db.collection("liveRooms").createIndex({ code: 1 }, { unique: true });
  await db.collection("liveRooms").createIndex({ updatedAt: 1 }, { expireAfterSeconds: 7200 });
}

export function players(db: Db): Collection<PlayerDoc> {
  return db.collection<PlayerDoc>("players");
}
export function matches(db: Db): Collection<MatchDoc> {
  return db.collection<MatchDoc>("matches");
}
export function duetScores(db: Db): Collection<DuetScoreDoc> {
  return db.collection<DuetScoreDoc>("duetScores");
}

export async function upsertPlayer(
  db: Db,
  clientId: string,
  displayName: string,
): Promise<PlayerDoc> {
  const name = displayName.trim().slice(0, 16) || "Singer";
  const now = new Date();
  await players(db).updateOne(
    { clientId },
    {
      $set: { displayName: name, updatedAt: now },
      $setOnInsert: { clientId, elo: StartingElo, matchesPlayed: 0 },
    },
    { upsert: true },
  );
  const doc = await players(db).findOne({ clientId });
  if (!doc) throw new Error("player upsert failed");
  return doc;
}

export async function applyEloAndBump(
  db: Db,
  aId: string,
  bId: string,
  deltaA: number,
  deltaB: number,
): Promise<void> {
  await players(db).updateOne(
    { clientId: aId },
    { $inc: { elo: deltaA, matchesPlayed: 1 }, $set: { updatedAt: new Date() } },
  );
  await players(db).updateOne(
    { clientId: bId },
    { $inc: { elo: deltaB, matchesPlayed: 1 }, $set: { updatedAt: new Date() } },
  );
}

export async function upsertDuetBest(
  db: Db,
  songId: string,
  nameA: string,
  nameB: string,
  shared: number,
): Promise<void> {
  const names = [nameA.trim(), nameB.trim()].sort((x, y) =>
    x.localeCompare(y),
  ) as [string, string];
  const now = new Date();
  await duetScores(db).updateOne(
    { songId, names },
    {
      $max: { score: shared },
      $set: { updatedAt: now },
      $setOnInsert: { songId, names, createdAt: now },
    },
    { upsert: true },
  );
}
