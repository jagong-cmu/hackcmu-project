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
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Mode, ScoreCard } from "../../packages/shared/src/index.ts";
import {
  applyEloAndBump,
  getDb,
  matches,
  mongoConfigured,
  players,
  duetScores,
  upsertDuetBest,
  upsertPlayer,
} from "./db.ts";
import { eloDelta, kForMatch, outcomeFromScores } from "./elo.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(here, "../../.env") });

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
const GEMINI_TIMEOUT_MS = 8000;

type PostedScore = {
  clientId: string;
  displayName?: string;
  score: ScoreCard;
  mode?: Mode;
  songId?: string;
  opponentClientId?: string;
  opponentName?: string;
  lyrics?: string;
  forfeit?: boolean;
  elapsedMs?: number;
};

type PendingTurn = {
  roomId: string;
  mode: Mode;
  songId: string;
  startedAt: number;
  entries: Array<{
    clientId: string;
    displayName: string;
    score: ScoreCard;
  }>;
};

export function clampCard(raw: ScoreCard): ScoreCard {
  const n = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const silence = Boolean(raw.silence);
  const pitch = silence ? 0 : n(raw.pitch);
  const tone = silence ? 0 : n(raw.tone);
  const overall = silence ? 0 : n(raw.overall);
  return {
    overall,
    pitch,
    tone,
    words: raw.words == null ? undefined : n(raw.words),
    silence,
    verdict: typeof raw.verdict === "string" ? raw.verdict.slice(0, 140) : "",
    source: raw.source === "dsp+gemini" ? "dsp+gemini" : "dsp",
  };
}

export async function geminiVerdict(input: {
  pitch: number;
  tone: number;
  overall: number;
  silence: boolean;
  lyrics?: string;
}): Promise<string> {
  if (input.silence) return "We couldn't hear you.";
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return "";

  const prompt = `You are the MC at Karaoke Arena, a live karaoke battle.
Write ONE short spoken verdict (max 140 characters).
Do not mention AI, models, or Gemini.
Do not invent or change any numbers. Do not output pitch/tone of your own.
Be specific to these scores and the lyric snippet.

overall=${input.overall} pitch=${input.pitch} tone=${input.tone}
lyrics:
${(input.lyrics || "").slice(0, 600)}

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
    const parsed = JSON.parse(text) as { verdict?: string };
    const verdict = (parsed.verdict || "").trim().slice(0, 140);
    return verdict;
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function attachVerdict(score: ScoreCard, lyrics?: string): Promise<ScoreCard> {
  const numbers: ScoreCard = { ...score, verdict: score.silence ? "We couldn't hear you." : "", source: "dsp" };
  if (numbers.silence) return numbers;
  const verdict = await geminiVerdict({
    pitch: numbers.pitch,
    tone: numbers.tone,
    overall: numbers.overall,
    silence: false,
    lyrics,
  });
  if (!verdict) return numbers;
  return { ...numbers, verdict, source: "dsp+gemini" };
}

async function finishRankedOrDuet(turn: PendingTurn): Promise<Record<string, unknown>> {
  const [a, b] = turn.entries;
  const db = await getDb();
  if (turn.mode === "duet") {
    const shared = Math.round((a.score.overall + b.score.overall) / 2);
    if (db) {
      await upsertPlayer(db, a.clientId, a.displayName);
      await upsertPlayer(db, b.clientId, b.displayName);
      await upsertDuetBest(db, turn.songId, a.displayName, b.displayName, shared);
      await matches(db).insertOne({
        roomId: turn.roomId,
        mode: "duet",
        songId: turn.songId,
        a: { clientId: a.clientId, displayName: a.displayName, score: a.score },
        b: { clientId: b.clientId, displayName: b.displayName, score: b.score },
        winnerId: null,
        eloDelta: null,
        createdAt: new Date(),
      });
    }
    return {
      complete: true,
      mode: "duet",
      shared,
      scores: { [a.clientId]: a.score, [b.clientId]: b.score },
      winnerId: null,
      eloDelta: null,
    };
  }

  const outcome = outcomeFromScores(a.score.overall, b.score.overall);
  const winnerId = outcome === 0.5 ? "draw" : outcome === 1 ? a.clientId : b.clientId;
  let delta = { a: 0, b: 0 };
  if (db) {
    const pa = await upsertPlayer(db, a.clientId, a.displayName);
    const pb = await upsertPlayer(db, b.clientId, b.displayName);
    const k = kForMatch({ forfeit: false });
    delta = eloDelta(pa.elo, pb.elo, outcome, k);
    await applyEloAndBump(db, a.clientId, b.clientId, delta.a, delta.b);
    await matches(db).insertOne({
      roomId: turn.roomId,
      mode: "ranked",
      songId: turn.songId,
      a: { clientId: a.clientId, displayName: a.displayName, score: a.score, elo: pa.elo },
      b: { clientId: b.clientId, displayName: b.displayName, score: b.score, elo: pb.elo },
      winnerId,
      eloDelta: delta,
      createdAt: new Date(),
    });
  } else {
    delta = eloDelta(1000, 1000, outcome);
  }

  return {
    complete: true,
    mode: "ranked",
    scores: { [a.clientId]: a.score, [b.clientId]: b.score },
    winnerId,
    eloDelta: delta,
  };
}

export async function enrichScore(raw: ScoreCard, lyrics?: string): Promise<ScoreCard> {
  return attachVerdict(clampCard(raw), lyrics);
}

/** Persist a completed Ranked/Duet room. Returns ELO delta for the first-seated player. */
export async function persistSeatedMatch(input: {
  code: string;
  mode: Mode;
  songId: string | null;
  players: Array<{ id: string; clientId: string; displayName: string }>;
  scores: Map<string, ScoreCard>;
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
    entries: [
      { clientId: a.clientId, displayName: a.displayName, score: sa },
      { clientId: b.clientId, displayName: b.displayName, score: sb },
    ],
  });
  const delta = over.eloDelta as { a?: number; b?: number } | null;
  return delta?.a ?? 0;
}

export function registerLaneBRoutes(app: Express): void {
  app.post("/api/player/hello", async (req: Request, res: Response) => {
    const clientId = String(req.body?.clientId || "");
    const displayName = String(req.body?.displayName || "Singer").slice(0, 16);
    if (!clientId) {
      res.status(400).json({ ok: false, error: "clientId required" });
      return;
    }
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
  });

  app.post("/api/training/score", async (req: Request, res: Response) => {
    const body = req.body as PostedScore;
    if (!body?.clientId || !body?.score) {
      res.status(400).json({ ok: false, error: "clientId and score required" });
      return;
    }
    let score = clampCard(body.score);
    score = await attachVerdict(score, body.lyrics);
    const db = await getDb();
    let player = null;
    if (db) player = await upsertPlayer(db, body.clientId, body.displayName || "Singer");
    res.json({ ok: true, score, mongo: Boolean(db), player });
  });

  app.get("/api/leaderboard/ranked", async (_req: Request, res: Response) => {
    const db = await getDb();
    if (!db) {
      res.json({ ok: true, mongo: false, rows: [] });
      return;
    }
    const rows = await players(db)
      .find({})
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
  });

  app.get("/api/leaderboard/duet", async (_req: Request, res: Response) => {
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
  });
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
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    console.log(`[lane-b] judge listening on :${port} mongo=${mongoConfigured()}`);
  });
}
