# Karaoke Arena — working rules

**Read first:** [`PRD.md`](./PRD.md) (game rules + UX) and [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) (stack, file ownership, lane split).
PRD wins on game rules. TECHNICAL_PRD wins on stack, scoring pipeline, and file ownership.

## Your lane = your git branch

Run `git branch --show-current`. It is `lane-a` or `lane-b`. That is your lane.
If you are on `main`, you are integrating — do not write feature code here.

Two people work this repo in parallel from separate worktrees. Crossing lanes causes
merge conflicts we do not have time for during a hackathon.

## File ownership — do not cross

| Path | Owner |
|---|---|
| `packages/shared/` | **BOTH — frozen.** Do not edit without both lanes agreeing in chat first. |
| `apps/web/src/App.tsx` | thin router only. Add a route; do not dump logic here. |
| `apps/web/src/media/`, `rooms/`, `stage/` | Lane A |
| `server/src/index.ts`, `rooms.ts`, `matchmaking.ts`, `clock.ts`, `livekit.ts` | Lane A |
| `render.yaml`, deploy config | Lane A |
| `apps/web/src/home/`, `lyrics/`, `scoring/`, `training/`, `results/`, `leaderboard/` | Lane B |
| `apps/web/public/songs/` | Lane B |
| `server/src/judge.ts`, `db.ts`, `elo.ts` | Lane B |

Lane A never calls Gemini or Mongo. Lane B never opens LiveKit or implements FIFO matchmaking.

If you need something in the other lane's files, stub it on your side and tell the user to
message their teammate. Do not edit across the line "just this once".

## Hard constraints

- **$0 stack.** Gemini AI Studio free tier (`gemini-2.5-flash-lite`, billing OFF), Atlas M0,
  LiveKit Cloud Build, Render Free or `cloudflared`. Never add a credit card. Never create
  Vultr / AWS / DigitalOcean resources.
- **DSP is the judge of record.** Gemini writes a one-line verdict from numbers we already
  computed. Never send audio to Gemini and ask it for a pitch score.
- **Secrets live in `.env` only** (gitignored). `GEMINI_API_KEY`, `MONGODB_URI`, and the
  LiveKit secret must never reach the client bundle. Client may only see `VITE_*` vars.
- **Never send audio blobs over Socket.IO.** Scores go over `POST /api/turns/:roomId/score`.
- Node 22, npm workspaces, TypeScript strict, desktop Chrome only.

## Protocol

`packages/shared` is the contract: types, Socket.IO event names, and tuning constants
(`RankedClipMs`, `EloK`, `ClockLeadMs`, …). Import from `@karaoke/shared` — do not
re-declare these values or hardcode the numbers in your lane.

## Git

- Commit on your lane branch. Push often; a hackathon partner cannot read your local disk.
- Rebase on `main` rather than merging it back and forth.
- Do not force-push shared branches.
