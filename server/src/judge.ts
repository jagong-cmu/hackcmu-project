/**
 * Lane B HTTP surface. Lane A should mount this on the Socket.IO app:
 *
 *   import { registerLaneBRoutes } from "./judge.ts";
 *   registerLaneBRoutes(app);
 *
 * Standalone (`npm run dev -w @karaoke/server`) serves Training / leaderboard
 * on :8080 until Lane A owns index.ts.
 *
 * Gemini receives numbers + lyrics only. It never invents pitch/tone.
 */
import cors from "cors";
import dotenv from "dotenv";
import express, { type Express, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overallFrom, songById, type Mode, type ScoreCard } from "../../packages/shared/src/index.ts";
import {
  applyEloAndBump,
  isDuplicateKey,
  getDb,
  matches,
  mongoConfigured,
  players,
  duetScores,
  upsertDuetBest,
  upsertPlayer,
} from "./db.ts";
import { eloDelta, kForMatch, outcomeFromScores } from "./elo.ts";
import { getArenaStats, trackMatchCompleted, trackTrainingCompleted } from "./analytics.ts";
import { httpIdentity } from "./auth.ts";
import { trainingEventBudget, verdictBudget, verdictConcurrency } from "./abuseLimits.ts";
import {
  asyncRoute,
  cleanText,
  jsonErrors,
  logOnce,
  memoizeFor,
  sanitizeDisplayName,
} from "./hardening.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(here, "../../.env") });

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
const GEMINI_TIMEOUT_MS = 2500;

type PendingTurn = {
  roomId: string;
  mode: Mode;
  songId: string;
  startedAt: number;
  forfeit?: boolean;
  outcome?: 0 | 0.5 | 1;
  /** Room.matchId: the {roomId, matchId} idempotency key on the matches doc. */
  matchId?: number | null;
  /** Ranked only. False for a friendly (private room) match: recorded, never rated. */
  rated?: boolean;
  entries: Array<{
    clientId: string;
    displayName: string;
    score: ScoreCard;
  }>;
};

export const SilenceVerdict = "We couldn't hear you.";
export const LyricsPromptMax = 600;

/** A posted score is a plain object (not an array, string, or null). */
export function isScoreBody(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * The client's DSP numbers, clamped. Verdict and source are never taken from
 * the client: the server writes the verdict (Gemini or nothing) and the label.
 * `overall` is never taken from the client either: it is recomputed from the
 * clamped pitch and tone with the shared formula (a silent take stays 0).
 */
export function clampCard(raw: unknown): ScoreCard {
  const card = (isScoreBody(raw) ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
  const silence = card.silence === true;
  const pitch = silence ? 0 : n(card.pitch);
  const tone = silence ? 0 : n(card.tone);
  const overall = silence ? 0 : overallFrom(pitch, tone);
  return {
    overall,
    pitch,
    tone,
    words: card.words == null ? undefined : n(card.words),
    silence,
    verdict: silence ? SilenceVerdict : "",
    source: "dsp",
  };
}

// ---------------------------------------------------------------------------
// Lyrics for the verdict prompt: the server's own song pack, never the client's.
// ---------------------------------------------------------------------------

const SONG_DIRS = [
  path.resolve(process.cwd(), "apps/web/public/songs"),
  path.resolve(here, "../../apps/web/public/songs"),
  path.resolve(process.cwd(), "apps/web/dist/songs"),
  path.resolve(here, "../../apps/web/dist/songs"),
  path.resolve(process.cwd(), "../apps/web/public/songs"),
];
const lyricsCache = new Map<string, string | null>();

/** First lines of a song's LRC from disk, timestamps and part tags removed. */
export function serverLyrics(songId: unknown): string | null {
  if (typeof songId !== "string" || !/^[a-z0-9-]{1,64}$/.test(songId) || !songById(songId)) {
    return null;
  }
  if (lyricsCache.has(songId)) return lyricsCache.get(songId) ?? null;
  let text: string | null = null;
  for (const dir of SONG_DIRS) {
    const file = path.join(dir, songId, "lyrics.lrc");
    try {
      if (!existsSync(file)) continue;
      const lines = readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/^\s*(A|B|AB):\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 12);
      text = cleanText(lines.join("\n"), LyricsPromptMax, { multiline: true }) || null;
      break;
    } catch {
      /* try the next location */
    }
  }
  lyricsCache.set(songId, text);
  return text;
}

/**
 * Lyrics for Gemini: the server's copy of the song when it can load one,
 * else the posted text as a capped, control-free string.
 */
export function verdictLyrics(songId: unknown, posted: unknown): string | undefined {
  return (
    serverLyrics(songId) ?? (cleanText(posted, LyricsPromptMax, { multiline: true }) || undefined)
  );
}

export async function geminiVerdict(input: {
  pitch: number;
  tone: number;
  overall: number;
  silence: boolean;
  lyrics?: string;
}): Promise<string> {
  if (input.silence) return SilenceVerdict;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return "";

  const prompt = `You are the MC at Karaoke Arena, a live karaoke battle.
Write ONE short spoken verdict (max 140 characters).
Do not mention AI, models, or Gemini.
Do not invent or change any numbers. Do not output pitch/tone of your own.
Be specific to these scores and the lyric snippet.

overall=${input.overall} pitch=${input.pitch} tone=${input.tone}
lyrics:
${cleanText(input.lyrics, LyricsPromptMax, { multiline: true })}

Return JSON only: {"verdict":"..."}`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), GEMINI_TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 80,
          responseMimeType: "application/json",
        },
      }),
    });
    if (res.status === 429 || !res.ok) return "";
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as { verdict?: unknown };
    return cleanText(parsed?.verdict, 140);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

/**
 * The DSP card plus a Gemini verdict when one is allowed. `who` is the
 * verified user the call is charged to (abuseLimits.ts: one per 15s, 30 per
 * hour, 4 in flight per instance). Over any limit, or without a key, the card
 * keeps the no-Gemini verdict and no call is made. Never throws for that.
 */
async function attachVerdict(score: ScoreCard, lyrics: string | undefined, who: string): Promise<ScoreCard> {
  const numbers: ScoreCard = { ...score, verdict: score.silence ? SilenceVerdict : "", source: "dsp" };
  if (numbers.silence) return numbers;
  if (!process.env.GEMINI_API_KEY?.trim()) return numbers;
  if (!verdictConcurrency.tryEnter()) return numbers;
  let verdict = "";
  try {
    if (!verdictBudget.take(who)) return numbers;
    verdict = await geminiVerdict({
      pitch: numbers.pitch,
      tone: numbers.tone,
      overall: numbers.overall,
      silence: false,
      lyrics,
    });
  } finally {
    verdictConcurrency.leave();
  }
  if (!verdict) return numbers;
  return { ...numbers, verdict, source: "dsp+gemini" };
}

async function finishRankedOrDuet(turn: PendingTurn): Promise<Record<string, unknown>> {
  const [a, b] = turn.entries;
  const db = await getDb();
  const matchKey = turn.matchId != null ? { matchId: turn.matchId } : {};
  if (turn.mode === "duet") {
    const shared = Math.round((a.score.overall + b.score.overall) / 2);
    if (db) {
      await upsertPlayer(db, a.clientId, a.displayName);
      await upsertPlayer(db, b.clientId, b.displayName);
      // The matches doc is the idempotency key: insert it first, and only the
      // insert that wins moves the leaderboard.
      try {
        await matches(db).insertOne({
          roomId: turn.roomId,
          mode: "duet",
          songId: turn.songId,
          a: { clientId: a.clientId, displayName: a.displayName, score: a.score },
          b: { clientId: b.clientId, displayName: b.displayName, score: b.score },
          winnerId: null,
          eloDelta: null,
          ...matchKey,
          createdAt: new Date(),
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        return { complete: true, duplicate: true, mode: "duet", shared, winnerId: null, eloDelta: null };
      }
      await upsertDuetBest(db, turn.songId, a.displayName, b.displayName, shared);
    }
    void trackMatchCompleted({
      mode: "duet",
      songId: turn.songId,
      roomCode: turn.roomId,
      forfeit: Boolean(turn.forfeit),
      distinctId: a.clientId,
    }).catch(logOnce("trackMatchCompleted"));
    return {
      complete: true,
      mode: "duet",
      shared,
      scores: { [a.clientId]: a.score, [b.clientId]: b.score },
      winnerId: null,
      eloDelta: null,
    };
  }

  const outcome = turn.outcome ?? outcomeFromScores(a.score.overall, b.score.overall);
  const winnerId = outcome === 0.5 ? "draw" : outcome === 1 ? a.clientId : b.clientId;
  const forfeitField = turn.forfeit ? { forfeit: true } : {};

  if (turn.rated === false) {
    // Friendly match: keep the record (history, the {roomId, matchId}
    // idempotency key), but never touch ELO or matchesPlayed. Stats that
    // count ranked matches skip rated:false docs (analytics.ts).
    if (db) {
      await upsertPlayer(db, a.clientId, a.displayName);
      await upsertPlayer(db, b.clientId, b.displayName);
      try {
        await matches(db).insertOne({
          roomId: turn.roomId,
          mode: "ranked",
          songId: turn.songId,
          a: { clientId: a.clientId, displayName: a.displayName, score: a.score },
          b: { clientId: b.clientId, displayName: b.displayName, score: b.score },
          winnerId,
          eloDelta: null,
          rated: false,
          ...forfeitField,
          ...matchKey,
          createdAt: new Date(),
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        return { complete: true, duplicate: true, mode: "ranked", rated: false, winnerId, eloDelta: null };
      }
    }
    void trackMatchCompleted({
      mode: turn.mode,
      songId: turn.songId,
      roomCode: turn.roomId,
      forfeit: Boolean(turn.forfeit),
      rated: false,
      distinctId: a.clientId,
    }).catch(logOnce("trackMatchCompleted"));
    return {
      complete: true,
      mode: "ranked",
      rated: false,
      scores: { [a.clientId]: a.score, [b.clientId]: b.score },
      winnerId,
      eloDelta: null,
    };
  }

  let delta = { a: 0, b: 0 };
  if (db) {
    const pa = await upsertPlayer(db, a.clientId, a.displayName);
    const pb = await upsertPlayer(db, b.clientId, b.displayName);
    const k = kForMatch({ forfeit: Boolean(turn.forfeit) });
    delta = eloDelta(pa.elo, pb.elo, outcome, k);
    // Insert the matches doc BEFORE touching ELO. The {roomId, matchId} unique
    // index makes a second settlement of the same live match fail here, so
    // ELO can only ever move once per match even if the liveRooms claim regresses.
    try {
      await matches(db).insertOne({
        roomId: turn.roomId,
        mode: "ranked",
        songId: turn.songId,
        a: { clientId: a.clientId, displayName: a.displayName, score: a.score, elo: pa.elo },
        b: { clientId: b.clientId, displayName: b.displayName, score: b.score, elo: pb.elo },
        winnerId,
        eloDelta: delta,
        rated: true,
        ...forfeitField,
        ...matchKey,
        createdAt: new Date(),
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Already settled elsewhere: report that settlement's numbers, apply nothing.
      const prior =
        turn.matchId != null
          ? await matches(db).findOne({ roomId: turn.roomId, matchId: turn.matchId })
          : null;
      return {
        complete: true,
        duplicate: true,
        mode: "ranked",
        winnerId: prior?.winnerId ?? winnerId,
        eloDelta: prior?.eloDelta ?? { a: 0, b: 0 },
      };
    }
    await applyEloAndBump(db, a.clientId, b.clientId, delta.a, delta.b);
  } else {
    delta = eloDelta(1000, 1000, outcome, kForMatch({ forfeit: Boolean(turn.forfeit) }));
  }

  void trackMatchCompleted({
    mode: turn.mode,
    songId: turn.songId,
    roomCode: turn.roomId,
    forfeit: Boolean(turn.forfeit),
    distinctId: a.clientId,
  }).catch(logOnce("trackMatchCompleted"));

  return {
    complete: true,
    mode: "ranked",
    scores: { [a.clientId]: a.score, [b.clientId]: b.score },
    winnerId,
    eloDelta: delta,
  };
}

/** Clamp + verdict, charged to `who` (the verified user id) for the Gemini limits. */
export async function enrichScore(raw: unknown, lyrics: string | undefined, who: string): Promise<ScoreCard> {
  return attachVerdict(clampCard(raw), lyrics, who);
}

/** Persist a completed Ranked/Duet room. Returns ELO delta for the first-seated player. */
export async function persistSeatedMatch(input: {
  code: string;
  mode: Mode;
  songId: string | null;
  players: Array<{ id: string; clientId: string; displayName: string }>;
  scores: Map<string, ScoreCard>;
  forfeit?: boolean;
  outcome?: 0 | 0.5 | 1;
  matchId?: number | null;
  /** Ranked: false for a friendly (private room) match. Recorded, no ELO; returns 0. */
  rated?: boolean;
}): Promise<number> {
  if (input.mode === "chaos" || input.players.length < 2) return 0;
  const [a, b] = input.players;
  const sa = a ? input.scores.get(a.id) : undefined;
  const sb = b ? input.scores.get(b.id) : undefined;
  if (!a || !b || !sa || !sb) return 0;
  const over = await finishRankedOrDuet({
    roomId: input.code,
    mode: input.mode,
    songId: input.songId || "unknown",
    startedAt: Date.now(),
    forfeit: input.forfeit,
    outcome: input.outcome,
    matchId: input.matchId,
    rated: input.rated,
    entries: [
      { clientId: a.clientId, displayName: a.displayName, score: sa },
      { clientId: b.clientId, displayName: b.displayName, score: sb },
    ],
  });
  const delta = over.eloDelta as { a?: number; b?: number } | null;
  return delta?.a ?? 0;
}

/** /api/stats runs several Mongo counts: computed at most once a minute. */
const cachedArenaStats = memoizeFor(60_000, getArenaStats);

export function registerLaneBRoutes(app: Express): void {
  app.post("/api/player/hello", asyncRoute(async (req: Request, res: Response) => {
    const who = await httpIdentity(req, req.body?.clientId);
    if (!who.ok) {
      res.status(who.status).json({ ok: false, error: who.message });
      return;
    }
    const clientId = who.clientId;
    const displayName = sanitizeDisplayName(req.body?.displayName);
    const db = await getDb();
    if (!db) {
      res.json({
        ok: true,
        mongo: false,
        player: { clientId, displayName, elo: 1000, matchesPlayed: 0 },
      });
      return;
    }
    const player = await upsertPlayer(db, clientId, displayName);
    res.json({ ok: true, mongo: true, player });
  }));

  app.post("/api/training/score", asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (typeof body.clientId !== "string" || !body.clientId || !isScoreBody(body.score)) {
      res.status(400).json({ ok: false, error: "clientId and score required" });
      return;
    }
    const who = await httpIdentity(req, body.clientId);
    if (!who.ok) {
      res.status(who.status).json({ ok: false, error: who.message });
      return;
    }
    const songId = typeof body.songId === "string" && songById(body.songId) ? body.songId : undefined;
    let score = clampCard(body.score);
    score = await attachVerdict(score, verdictLyrics(songId, body.lyrics), who.clientId);
    const db = await getDb();
    let player = null;
    if (db) player = await upsertPlayer(db, who.clientId, sanitizeDisplayName(body.displayName));
    // Analytics (PostHog event + stats counter) are capped per user too, so a
    // looping client cannot flood them. The score is returned either way.
    if (trainingEventBudget.take(who.clientId)) {
      void trackTrainingCompleted({
        songId,
        distinctId: who.clientId,
        overall: score.overall,
      }).catch(logOnce("trackTrainingCompleted"));
    }
    res.json({ ok: true, score, mongo: Boolean(db), player });
  }));

  app.get("/api/stats", asyncRoute(async (_req: Request, res: Response) => {
    res.json(await cachedArenaStats());
  }));

  app.get("/api/leaderboard/ranked", asyncRoute(async (_req: Request, res: Response) => {
    const db = await getDb();
    if (!db) {
      res.json({ ok: true, mongo: false, rows: [] });
      return;
    }
    const rows = await players(db)
      .find({ linkedTo: { $exists: false } })
      .sort({ elo: -1, matchesPlayed: -1 })
      .limit(50)
      .toArray();
    res.json({
      ok: true,
      mongo: true,
      rows: rows.map((p, i) => ({
        rank: i + 1,
        displayName: p.displayName,
        elo: p.elo,
        matchesPlayed: p.matchesPlayed,
      })),
    });
  }));

  app.get("/api/leaderboard/duet", asyncRoute(async (_req: Request, res: Response) => {
    const db = await getDb();
    if (!db) {
      res.json({ ok: true, mongo: false, rows: [] });
      return;
    }
    const rows = await duetScores(db).find({}).sort({ score: -1 }).limit(50).toArray();
    res.json({
      ok: true,
      mongo: true,
      rows: rows.map((d, i) => ({
        rank: i + 1,
        songId: d.songId,
        names: d.names,
        score: d.score,
      })),
    });
  }));
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));
  registerLaneBRoutes(app);
  app.use(jsonErrors);
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    console.log(`[lane-b] judge listening on :${port} mongo=${mongoConfigured()}`);
  });
}
