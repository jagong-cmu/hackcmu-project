# Karaoke Arena — Technical PRD

**Status:** Final v1.0 for HackCMU  
**Depends on:** [`PRD.md`](./PRD.md) for game rules and UX.

This file is how we build it, on what, who owns which files, and the two Cursor prompts.

**Product vs this file:** PRD wins on game rules (turns, ELO, Chaos). This file wins on stack, scoring pipeline, and file ownership.

---

## 0. Zero-dollar rule

**Weekend cost is $0.** No paid plans. If a signup wants a card to “unlock” the product, stop and use the free path.

| Use | Do not use |
|---|---|
| Gemini **AI Studio Free**, `gemini-2.5-flash-lite`, billing **off** | Gemini billed / Pro / Vertex |
| Atlas **M0 Free forever** | M2+, App Services, adding a card |
| LiveKit Cloud **Build** | Self-hosted LiveKit, paid LiveKit, LiveKit Inference |
| Render **Free** or `cloudflared` from a laptop | Vultr, AWS, DigitalOcean, any hourly VPS |

Vultr is out: no free VPS, credits want a card, leftover VMs bill you. It would only have been a rented Linux box for Node + SFU. LiveKit Cloud + Render replace it.

---

## 1. System

```text
Chrome A / Chrome B
  cam+mic → LiveKit Cloud (faces/voice only)
  /songs/*.mp3 → local <audio>, lyrics from currentTime
  pitchy meter (live)
  DSP ScoreCard (pitch, tone, overall) → POST /api/turns/:roomId/score

Render Free Node (or cloudflared)
  Socket.IO rooms, clock, matchmaking
  LiveKit token mint
  judge.ts  → Gemini verdict from numbers (optional)
  db.ts     → Atlas M0 players / matches / ELO / duets
```

If Atlas is down, the ladder dies. If DSP fails, there is no score. If Gemini is down, numbers still show.

---

## 2. Sponsors in the running app

| Sponsor | Job | Without it |
|---|---|---|
| **Gemini Free** | One-line verdict from already-computed scores. Optional `words` later. | Scores still work. No MC line. |
| **Atlas M0** | Players, ELO, matches, duet highs | Refresh wipes the arena |

Gemini is **not** the pitch judge. PitchBench (2026): Gemini 3 Flash 14% / Pro 17.8% on pitch tasks vs ~85–90% for CREPE-class trackers. Do not send audio and ask for `pitch: 87`.

Tencent Vocal Score, BytePlus sing-scoring, Chivox, VoxaTrace would score better as hosted karaoke APIs. They are not $0 this weekend. Music.AI/Moises is stems, not scoring.

---

## 3. Stack (locked)

| Layer | Choice |
|---|---|
| Client | React + Vite + TypeScript, Chrome desktop |
| Realtime | Socket.IO on Node |
| Video/voice | LiveKit Cloud Build |
| Song files | `apps/web/public/songs` |
| Live meter | `pitchy` |
| Official pitch/tone | essentia.js `PitchYinProbabilistic` + HNR, or reuse `pitchy` contour vs `melody.json` |
| Verdict | Gemini 2.5 Flash-Lite, numbers in, sentence out |
| Data | Atlas M0, db `karaoke-arena` |
| Host | Render Free, else Cloudflare Quick Tunnel |

Node 22, npm workspaces.

---

## 4. File ownership (do not cross)

```text
packages/shared/           BOTH freeze first, then do not edit without a shout
apps/web/src/App.tsx       thin router only; add a route, do not dump logic here
apps/web/src/media/        LANE A
apps/web/src/rooms/        LANE A
apps/web/src/stage/        LANE A
server/src/index.ts        LANE A
server/src/rooms.ts        LANE A
server/src/matchmaking.ts  LANE A
server/src/clock.ts        LANE A
server/src/livekit.ts      LANE A
render.yaml                LANE A
apps/web/src/home/         LANE B
apps/web/src/lyrics/       LANE B
apps/web/src/scoring/      LANE B
apps/web/src/training/     LANE B
apps/web/src/results/      LANE B
apps/web/src/leaderboard/  LANE B
apps/web/public/songs/     LANE B
server/src/judge.ts        LANE B
server/src/db.ts           LANE B
server/src/elo.ts          LANE B
```

Lane A never calls Gemini or Mongo. Lane B never opens LiveKit or implements FIFO.

---

## 5. Shared protocol (frozen)

Canonical copy: `packages/shared`. Types below are the contract.

### 5.1 Types

```ts
export type Mode = "ranked" | "duet" | "training" | "chaos";

export type ScoreCard = {
  overall: number;
  pitch: number;
  tone: number;
  words?: number;
  silence: boolean;
  verdict: string;
  source: "dsp" | "dsp+gemini";
};

export type SongMeta = {
  id: string;
  title: string;
  artist: string;
  clipStartSec: number;
  clipDurationSec: number;
  duetClipStartSec: number;
  duetClipDurationSec: number;
  chaosDurationSec: number;
};

export type PlayerPublic = {
  id: string;
  clientId: string;
  displayName: string;
  elo: number;
};

export type RoomState = {
  code: string;
  mode: Mode;
  players: PlayerPublic[];
  songId: string | null;
  status: "lobby" | "countdown" | "turnA" | "swap" | "turnB" | "results" | "live";
  activeSingerId: string | null;
  playAtUnixMs: number | null;
  playheadSec: number;
};
```

Catalog ids: `viva-la-vida` | `creep` | `california-gurls` | `payphone` | `perfect` | `take-on-me`.

### 5.2 Events

Client → server: `player:hello { clientId, displayName }`, `queue:join { mode }`, `room:create { mode }`, `room:join { code }`, `room:ready`, `chaos:join { code? }`.

Server → client: `player:ok { player }`, `room:state`, `match:found`, `clock:play { songId, startSec, durationSec, playAtUnixMs }`, `score:ready { playerId, score }`, `match:over { scores, winnerId, eloDelta, forfeit? }`, `error { code, message }`.

**Score upload (not audio):** `POST /api/turns/:roomId/score` with `{ clientId, score: ScoreCard }` after the local DSP run. Lane B implements the handler + Gemini verdict merge. Lane A mounts the route and advances the turn machine when both Ranked scores (or both Duet scores) are in.

Do not send 15s blobs over Socket.IO.

### 5.3 Stage slots

Lane A `<Stage>` provides context `{ audioRef, micStream, room }` and renders VideoGrid, TurnBadge, ClipTimer. It slots `<LyricsOverlay />`, `<PitchMeter />`, `<ResultsModal />` from Lane B. B does not import LiveKit.

---

## 6. Lane A — realtime

**Done when:** two Chromes join `0000` or a real code, see faces, hear mics, start the same mp3 within ~100ms.

- LiveKit Cloud Build. Token per player+room. Publish cam+mic. Do not publish the instrumental.
- In-memory rooms. Ranked/Duet cap 2. Chaos cap 8, id `chaos` for public.
- First joiner is Player A (`activeSingerId` on `turnA`).
- FIFO queues for ranked and duet. Code `0000` always exists as Ranked.
- Clock: `playAtUnixMs = Date.now() + 400`. Client plays when due, seek to startSec. Re-seek if drift >0.15s.
- Ranked machine: both ready → random song → countdown 3s → turnA 15s → swap 2s → turnB 15s → wait for two POSTs → `match:over`. Disconnect → forfeit.
- Chaos: autoplay 60s from `chaosDurationSec`, join mid-song with `playheadSec`, empty room stops, next joiner starts in 3s.
- Deploy: Render Free serving Vite dist + Node. If Render wants a card: `cloudflared tunnel --url http://localhost:8080`. HTTPS required for `getUserMedia` off localhost.
- Render sleeps: wake the URL before judging; rooms are memory-only and die on sleep.

---

## 7. Lane B — karaoke brain

**Done when:** Training on one laptop shows a moving meter and a pitch/tone score; Home/Results/Leaderboard exist; Atlas upserts a player.

**DSP (judge of record)**

1. Mic PCM for the clip.
2. Pitch vs `melody.json`, octave-invariant, skip nulls. Cents → 0–100, casual in-tune **70–85**.
3. Tone: HNR + f0 jitter → 0–100.
4. `overall = round(0.7 * pitch + 0.3 * tone)`. Silence → 0.
5. POST ScoreCard.

**Gemini:** `judge.ts` gets `{ pitch, tone, overall, lyrics }`, returns `{ verdict }` max 140 chars. 8s timeout. 429 → empty verdict, still `dsp`. Never overwrite numbers. `words` is P2.

**Atlas M0:** db `karaoke-arena`

```
players     { clientId unique, displayName, elo, matchesPlayed, updatedAt }
matches     { mode, songId, a, b, winnerId, eloDelta, createdAt }
duetScores  { songId, names[2] sorted, score, createdAt }
```

ELO start 1000, K=32. Draw 0.5. Forfeit <5s skip; else K=16.

**Songs:** `apps/web/public/songs/<id>/{instrumental.mp3,lyrics.lrc,meta.json,melody.json}`. A song without `melody.json` stays disabled. Three complete tracks beat six incomplete ones. Prefer shipping viva-la-vida, payphone, take-on-me first.

**UI:** Home, permissions copy, Training, Results (hide A’s numbers until `match:over`), Leaderboard.

---

## 8. Env

```bash
MONGODB_URI=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_WS_URL=wss://<project>.livekit.cloud
PUBLIC_URL=
```

Client: `VITE_SOCKET_URL`, `VITE_LIVEKIT_WS_URL` only. `.env` is gitignored.

---

## 9. Schedule and checkpoints

| Hours | A | B |
|---|---|---|
| 0–1 together | Create Gemini (no billing), Atlas M0, LiveKit Build. Confirm `packages/shared` compiles. | same |
| 1–4 | Two-tab LiveKit video | Home + Atlas hello + Training meter |
| 4–8 | Friend room + clock + one song in sync | LRC + DSP vs melody.json |
| 8–12 | Ranked A/B machine | POST score, Results, ELO |
| 12–16 | Public URL two laptops | Rest of songs, leaderboard, Gemini verdict |
| 16–20 | Chaos | Duet average |
| 20–24 | Wake Render, hotspot | Calibrate cents curve |

Checkpoints: (1) shared compiles (2) `clock:play` moves lyrics (3) two ScoreCards finish a Ranked match (4) two real laptops on the public URL.

Cut Chaos if late. P0 is Ranked + Training.

---

## 10. Production checklist (hackathon ship)

- [ ] HTTPS public URL, two physical machines, cameras + scores
- [ ] `0000` works without a second person creating a room
- [ ] Training works with LiveKit down
- [ ] `.env` not in git; Gemini key not in the client bundle
- [ ] Atlas is M0; Gemini project has no billing; LiveKit is Build
- [ ] At least one song has all four files; disabled songs hidden
- [ ] Decent singer on the calibration track lands ~70–85, not 12
- [ ] Render (or tunnel) warmed 2 minutes before the demo
- [ ] Phone hotspot ready

---

## 11. Lane prompts

Copy one prompt per Cursor chat. Do not give both people the same prompt.

### 11.1 Prompt for the other person — Lane A (realtime)

```
You are Lane A on Karaoke Arena (HackCMU). Repo: this project.

Read PRD.md and TECHNICAL_PRD.md. Follow TECHNICAL_PRD.md for stack and files. Do not contradict PRD.md game rules.

You own ONLY:
- apps/web/src/media/
- apps/web/src/rooms/
- apps/web/src/stage/
- server/src/index.ts, rooms.ts, matchmaking.ts, clock.ts, livekit.ts
- render.yaml / deploy

Do NOT edit: scoring, lyrics, home, training, results, leaderboard, songs/, server/src/judge.ts, db.ts, elo.ts.
Do NOT change packages/shared unless both lanes agree in chat.
Do NOT create Vultr/AWS/DigitalOcean. Do NOT put a credit card on LiveKit or Render. LiveKit Cloud Build + Render Free, or cloudflared tunnel.

Build, in order:
1. npm workspaces if missing. Dev: Vite + Node + Socket.IO.
2. LiveKit Cloud: two Chrome tabs, cam+mic, names on tiles.
3. Friend rooms + code 0000 (always-on Ranked). First joiner is Player A.
4. clock:play so both clients start the same /songs mp3 at playAtUnixMs. Re-seek if drift >150ms. Never put the song on WebRTC.
5. Ranked state machine: lobby → countdown 3s → turnA 15s → swap 2s → turnB 15s → wait for two POST /api/turns/:roomId/score (Lane B will implement the handler; mount an empty stub that accepts JSON) → match:over. Stub score:ready if B is not ready: {overall:80,pitch:82,tone:74,silence:false,verdict:"",source:"dsp"}.
6. Stage.tsx slots LyricsOverlay, PitchMeter, ResultsModal (B will fill them). Provide StageContext { audioRef, micStream, room }.
7. Public HTTPS deploy (Render Free or cloudflared). getUserMedia needs HTTPS.
8. If time: Chaos lounge (id chaos, cap 8, join/leave, 60s autoplay, playhead for late join).

Blockers to unblock yourself:
- packages/shared types: use what's in TECHNICAL_PRD §5. Don't wait to invent events.
- Song mp3: if B hasn't added files, put a 15s silent or click-track mp3 at apps/web/public/songs/_test/ so clock work can proceed.
- LiveKit keys: create a free Build project, put keys in server/.env (gitignored). Share the .env shape with Lane B, not the other way around for Mongo/Gemini.

Done = two laptops, code 0000, faces, same track start, turn badges. Scoring UI is not your job.
```

### 11.2 Prompt for this session — Lane B (karaoke brain)

```
You are Lane B on Karaoke Arena (HackCMU). Repo: this project.

Read PRD.md and TECHNICAL_PRD.md. Follow them. DSP is judge of record. Gemini only writes a verdict from numbers. $0 stack only (Atlas M0, Gemini AI Studio Free, no billing).

You own ONLY:
- apps/web/src/home, lyrics, scoring, training, results, leaderboard
- apps/web/public/songs/
- server/src/judge.ts, db.ts, elo.ts

Do NOT edit media/, rooms/, stage/, livekit.ts, clock.ts, matchmaking.ts, rooms.ts.
Do NOT change packages/shared unless both lanes agree.
Do NOT open LiveKit connections or implement matchmaking.
Do NOT ask Gemini for pitch/tone numbers.

Build, in order:
1. Atlas M0 cluster, no card, db karaoke-arena, MONGODB_URI in server/.env.
2. Home: display name, four modes. Ranked/Duet: Random / Enter code / Join 0000 buttons that call Lane A's room hooks (dummy handlers OK until A lands). Chaos: Join lounge / Enter code. Leaderboard link.
3. Training page: getUserMedia, pitchy meter vs melody.json, lyrics from LRC + audio.currentTime, after clip compute ScoreCard (pitch, tone, overall=round(0.7*pitch+0.3*tone)).
4. POST /api/turns/:roomId/score (and a training equivalent) — DSP on client, server stores and for Ranked/Duet applies ELO / duet best. Mount this on A's index when they expose the app.
5. Results modal: hide A's numbers until match:over. Show overall + pitch + tone. Gemini verdict via judge.ts (numbers + lyrics in, one sentence out). 429 → blank verdict.
6. Leaderboard GET ranked + duet.
7. Songs: each id needs instrumental.mp3, lyrics.lrc, meta.json, melody.json. Disable songs missing melody.json. Ship viva-la-vida, payphone, take-on-me first if time is short. Karaoke instrumentals, chorus cuts, ~128kbps.
8. Calibrate cents→100 so a decent take is 70–85.

Blockers:
- If A hasn't built StageContext, Training is self-contained (own audio element + mic). Do Training first so you are never blocked.
- If no LiveKit, Training still demos the product.
- Gemini key: AI Studio free, model gemini-2.5-flash-lite, never in the client.
- melody.json format is in PRD.md §8. Build offline.

Done = one laptop Training works end to end with a real score, Home exists, Atlas has a player doc. Then wire Results to A's match:over.
```

---

## 12. Before either lane starts (15–45 min, same table)

1. Create the three free accounts (Gemini no billing, Atlas M0, LiveKit Build). Put secrets in `server/.env` only.
2. Confirm `packages/shared` matches §5.
3. Agree: Jonathan’s chat is Lane B unless you swap; the other laptop is Lane A.
4. Then stop talking and split.
