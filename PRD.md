# Karaoke Arena — Product Requirements Document

**Status:** Final v1.0 for HackCMU (Multiplayer track)  
**Date:** 2026-09-11  
**How it is built:** [`TECHNICAL_PRD.md`](./TECHNICAL_PRD.md) (locked stack, file ownership, lane split).

This file is the source of truth for **what players see and do**. The technical PRD is the source of truth for **how it is implemented**. If they disagree, the technical PRD wins on stack and scoring mechanics; this file wins on game rules and UX.

---

## 1. Pitch

Karaoke Arena is a live, camera-on karaoke website where people see each other, follow timed lyrics, and compete or collab in short vocal battles scored on pitch and tone.

## 2. Why this wins the multiplayer track

The track is about people interacting and socializing, not just sharing a scoreboard.

It should feel like sitting across a table from someone with a karaoke machine between you:

- You **see** the other person (webcam).
- You **hear** them sing (mic).
- You **sing the same line** they just sang, or you sing **with** them.
- The room reacts together: countdown, lyrics, scores, winner banner.

If cameras, mics, or shared playback fail, the social product fails even if scoring works.

## 3. Goals and non-goals

### Goals (must demo)

1. Two people can be in the same room, cameras on, within ~30 seconds of landing on the site.
2. A ranked 1v1 match plays a karaoke instrumental, shows synced lyrics, and has each player sing the **same 15-second chorus clip**.
3. A pitch/tone engine returns **overall 0–100** plus **pitch** and **tone** subscores, then declares a winner. Gemini may add a one-line verdict. Gemini does not invent the numbers.
4. Friends skip matchmaking with a 4-digit room code. Code `0000` is a permanent demo room.
5. Duet: two people sing together, shared score, no ELO, leaderboard.
6. Training: solo, live pitch visualizer, same scoring.
7. Chaos: public lounge, join/leave anytime, cameras on, no score.

### Non-goals

- Accounts, email, passwords. Display name + `localStorage` client id.
- In-app recording/export. Screen-record the demo.
- Catalog larger than six tracks.
- Training a custom pitch model. Use essentia.js / `pitchy` vs `melody.json`.
- Custom ELO library. Standard K=32 math.
- Moderation, reports, kicks (mute toggle only).
- Mobile-native apps. Desktop Chrome only.
- Spectators, best-of-3, call-and-response duet, host song picker.
- Paid cloud (Vultr, billed Gemini, Atlas above M0).

---

## 4. Users and identity

| Role | What they do |
|---|---|
| Player | Name, cam/mic, pick a mode, sing |
| Opponent / partner | The other person in Ranked or Duet |
| Chaos participant | 1–8 people, walk in/out, no score |

No spectator role in v1.

**Identity**

- Display name, 2–16 characters, prompted once.
- Random avatar color.
- Stable `clientId` (UUID) in `localStorage` with the name.
- ELO and history key off `clientId`, not the display name. Duplicate names are allowed.
- No auth.

---

## 5. Core loop

```
Land → name → cam/mic → mode

Ranked / Duet:
  Random  or  Enter code  or  Join 0000
  → lobby (faces, assigned song title, Ready)
  → countdown
  → instrumental + lyrics + faces
  → scores (overall, pitch, tone)
  → rematch / home

Training:
  pick song → Start → visualizer → score

Chaos:
  Join lounge or enter code
  → grid, mid-song OK
  → leave whenever
```

---

## 6. Game modes

### 6.1 Ranked (primary)

**Players:** 2. **ELO:** yes. **Goal:** higher overall score on the same 15s clip.

**Who is A / B:** first to join the room is Player A and sings first.

**Song pick:** server picks a random catalog song. No picker in v1 (random queue and friend rooms).

**Flow**

1. Match found (queue, friend code, or `0000`).
2. Two-up video. Mics live in lobby.
3. Both tap Ready. Server broadcasts countdown + `clock:play`.
4. 3s countdown. Upcoming lyrics dimmed.
5. **Turn A (15s):** same clip for both. Only A’s mic is scored. B is visible and audible socially. A’s numeric score is hidden (“locked in”).
6. 2s swap beat.
7. **Turn B (15s):** identical clip and lyrics.
8. Reveal both ScoreCards, winner, ELO delta.
9. Rematch (new random song, same pair) or Leave.

**Win rules**

- Higher `overall` wins.
- Tie: “Draw”, ELO unchanged.
- Disconnect after start: remaining player wins by forfeit. Skip ELO if the match ran under 5s. Otherwise apply forfeit with K=16 (not 32).

**On stage:** opponent cam large, self pip, current + next lyric, 15s timer, YOUR TURN / THEIR TURN, live pitch meter for the active singer.

### 6.2 Duet

**Players:** 2. **ELO:** no. **Goal:** shared `overall` on the leaderboard.

**v1 is Together only:** both sing the same ~45s chorus at the same time. Each client scores its own mic. Server stores `round((a.overall + b.overall) / 2)`.

Call-and-response is out of v1.

Song pick: server random, same as Ranked.

Leaderboard key: `(songId, nameA, nameB)` with names sorted alphabetically. Keep best shared score.

### 6.3 Training

Solo. Pick a song. Start. Self cam optional (requested, not required). Instrumental + lyrics + live pitch vs `melody.json`. After the clip: overall, pitch, tone, optional Gemini verdict.

This is the one-laptop judge fallback.

### 6.4 Chaos

Persistent lounge, not a match. **No scoring.**

- Public lounge: one tap from Home, id `chaos`, cap 8.
- Private: 4-digit code, same rules, cap 8.
- Join/leave anytime. Late join seeks to current playhead.
- Autoplay random **60s** chorus-to-bridge cuts. When a cut ends, next random song starts.
- Empty room: stop clock. Next joiner starts a new song in 3s.
- Full: “Lounge full.”
- All mics and cameras live. Lyrics always on.
- No Ready, no Next button in v1.

---

## 7. Cameras, mics, instrumental

- Request cam+mic on first mode select. Deny camera → named avatar tile + “camera off”. Demo with cameras on.
- Layouts: Ranked/Duet opponent-dominant; Chaos equal grid; Training self + graph.
- Name under every tile. Gold border on the active singer (Ranked only).
- Lobby and Chaos: all mics open. Ranked: all mics open socially; **only the active singer’s buffer is scored**. Duet Together: both scored. Chaos: never scored.
- Local mute. Mute during your Ranked turn → overall 0, “We couldn’t hear you.”
- Instrumental is a **local file** on every client, started from a server `playAtUnixMs`. Lyrics follow `audio.currentTime`. Drift >150ms → re-seek. **Never** send the song through WebRTC.
- Karaoke / instrumental mixes only. No original lead vocal in the playback mix.
- Video delay 200–500ms is acceptable. Lyric sync must feel tight locally.

---

## 8. Lyrics and song files

Show current line (large) and next line (dim). Line-timed LRC is v1. Word-timed is bonus. High contrast, readable from 1–2m.

Each track, under `apps/web/public/songs/<id>/`:

| File | Required |
|---|---|
| `instrumental.mp3` | yes (chorus-cut, ~128 kbps) |
| `lyrics.lrc` | yes |
| `meta.json` | yes |
| `melody.json` | **yes** (pitch scoring and Training meter cannot ship without it) |

```json
{
  "id": "viva-la-vida",
  "title": "Viva La Vida",
  "artist": "Coldplay",
  "clipStartSec": 47,
  "clipDurationSec": 15,
  "duetClipStartSec": 47,
  "duetClipDurationSec": 45,
  "chaosDurationSec": 60
}
```

```json
{
  "sampleRateHz": 50,
  "startSec": 47,
  "hz": [220.0, 220.0, null, 233.08]
}
```

`hz` is one sample per `1/sampleRateHz` seconds from `startSec`. `null` = rest / unvoiced. Build this offline from a guide vocal or chorus MIDI. Do not extract it from the instrumental at runtime.

Clip windows start at the **chorus**.

---

## 9. Scoring (player-facing)

**What they see**

- `overall` 0–100 (integer) — this decides Ranked.
- `pitch` 0–100 — intonation vs `melody.json`.
- `tone` 0–100 — stability + clarity (not “celebrity timbre”).
- Optional Gemini one-liner. Optional `words` 0–100 (stretch).
- Silence: 0 and “We couldn’t hear you.”

**How it is computed (locked)**

1. Capture the singer’s mic for the clip window.
2. Estimate f0 (`pitchy` live; essentia.js or the same contour for the official card).
3. Compare to `melody.json`, octave-invariant, skip unvoiced frames.
4. Map mean cents error to 0–100 so a casual in-tune chorus lands **70–85**.
5. Tone from pitch stability + harmonic-to-noise. `overall = round(0.7 * pitch + 0.3 * tone)`.
6. Client POSTs the ScoreCard. Server trusts it (anti-cheat out of scope).
7. Gemini may receive the **numbers + lyric text** and return a verdict. It must not overwrite pitch/tone.

**ELO (Ranked only)**

- Start 1000, K=32, standard expected score. Win 1, loss 0, draw 0.5.
- Show `+18` / `-18` on results.
- Ladder: name, rating, matches played.

---

## 10. Matchmaking and lobby

- **Random:** FIFO queue per mode (ranked / duet). 30s timeout → retry or create a friend room.
- **Friend:** host gets 1000–9999. Guest types it. Wrong code: inline error. Empty rooms expire after 10 minutes.
- **0000:** always-on Ranked friend room for judges.
- Ranked/Duet lock at 2. Chaos cap 8.
- Lobby shows faces, **assigned song title** (not a picker), room code + copy, Ready, Start when both ready.
- First joiner is host for copy-code UX only. Song is still server-picked.

---

## 11. Catalog (locked)

| id | Title | Artist |
|---|---|---|
| `viva-la-vida` | Viva La Vida | Coldplay |
| `creep` | Creep | Radiohead |
| `california-gurls` | California Gurls | Katy Perry |
| `payphone` | Payphone | Maroon 5 |
| `perfect` | Perfect | Ed Sheeran |
| `take-on-me` | Take On Me | a-ha |

Take On Me is the hard/funny sixth track (replaces the garbled “Facebook” from the transcript). Last Friday Night, Sugar, and Sunday Morning are out.

A song does not ship until all four files in section 8 exist. Shipping three complete songs beats six broken ones.

---

## 12. Screens

1. **Home** — name, four mode cards. Ranked/Duet: Random, Enter code, Join 0000. Chaos: Join lounge, Enter code. Footer: Leaderboard.
2. **Permissions** — “Karaoke Arena needs your camera and mic so people can see you sing.” Enable / Continue without camera.
3. **Lobby** — tiles, song title, Ready, code.
4. **Stage** — cameras, lyrics, timer, turn badge, pitch meter. This is the screenshot.
5. **Results** — both overalls, pitch/tone, winner, ELO or “Submitted to leaderboard”, Gemini line if present, Rematch / Home.
6. **Training** — self cam, graph, lyrics, Start/Stop.
7. **Leaderboard** — Ranked ELO | Duet highs.

---

## 13. User stories (v1 done when all true)

1. Set a name and enable camera in under 20 seconds.
2. Two friends share a 4-digit code and see each other’s faces.
3. Ranked: same 15s chorus, lyrics highlight, A then B, two ScoreCards, a winner.
4. Ranked ELO changes and appears on the ladder.
5. Duet Together lands a shared score on the duet board.
6. Training on one laptop: meter moves, score appears.
7. Current lyric is readable without hunting.
8. Chaos: walk in mid-song, see faces, leave without killing the room.

---

## 14. Build order

Stop at the first row you can demo if time dies.

| P | Slice |
|---|---|
| P0 | Home, name, cam/mic, Training with lyrics + meter + pitch/tone score |
| P0 | Friend code, 2-up video, shared instrumental + lyrics |
| P0 | Ranked A/B turns, two ScoreCards, winner |
| P1 | ELO + Atlas ladder, Gemini verdict, Random queue, `0000` |
| P1 | Duet Together + duet board |
| P1 | Chaos lounge |
| P2 | Gemini `words` subscore, Chaos Next button |
| out | Best of 3, call-and-response, spectators, recording, song picker |

**Success bar:** two laptops, friend code, faces, chorus, lyrics, two turns, winner. Crowd can tell it is social.

---

## 15. Assumptions (locked)

| ID | Call |
|---|---|
| A1 | No accounts. |
| A2 | Ranked is the same clip twice, sequential. |
| A3 | One clip per Ranked match. |
| A4 | Hide A’s numbers until B finishes. |
| A5 | Scores are 0–100. |
| A6 | 4-digit numeric codes. |
| A7 | FIFO matchmaking. |
| A8 | Local instrumentals, not YouTube. |
| A9 | Line-timed LRC. |
| A10 | Client DSP is judge of record. Server trusts the posted ScoreCard. Gemini is verdict only. |
| A11 | Chaos is P1, no score, join/leave, cap 8, 60s cuts. |
| A12 | Desktop Chrome. |
| A13 | No in-app recording. |
| A14 | Duet Together only. |
| A15 | Catalog is the six rows in section 11. |
| A16 | Camera requested; every person still gets a tile. |
| A17 | Server picks the song for Ranked and Duet. |
| A18 | First joiner is Player A. |
| A19 | Training camera optional. Spectator out. |
| A20 | $0 stack only. See technical PRD. |

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| WebRTC dies on venue Wi-Fi | Two-network test, phone hotspot, Training fallback |
| Lyrics drift | Local file + `audio.currentTime` |
| Scores look random | Calibrate cents curve on one song until a decent take is ~80 |
| Missing `melody.json` | Do not enable that song |
| Copyright | Six karaoke clips, hackathon-only |
| Scope | Follow the P table |

---

## 17. Copy

- Name: **Karaoke Arena**
- Modes: Ranked, Duet, Training, Chaos
- CTAs: Random match, Play with a friend, Enter code, Join 0000, Join lounge, I’m ready, Start match, Rematch
- Do not lead with “AI”. Say “pitch and tone, 0–100.”

---

## 18. Closed questions

| Question | Call |
|---|---|
| Sixth song | Take On Me — a-ha |
| Asset owners | Lane B. Karaoke instrumentals OK for this closed demo |
| Training camera | Optional, requested |
| Stack | Locked in TECHNICAL_PRD.md |
| Spectator laptop | Out of v1 |
| Chaos length | 60s |

Brainstorm appendix (intent only): ranked 1v1 same lines; duet collab; training pitch guide; score /100; 15s chorus turns; random or friend code; no duet ELO; Chaos as a bar; no recording MVP; cameras on; synced lyrics.
