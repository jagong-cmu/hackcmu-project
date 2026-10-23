# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Competitive player:** several sessions a week; wants quick matchmaking, clear Elo stakes, a satisfying result reveal.
- **Friend group:** occasional, in bursts (evenings, parties); joins by 4-digit room code; plays Duet and Chaos for fun.
- **Solo practicer:** a few times a week; uses Training with a readable pitch visualizer.
- **First-time visitor or demo viewer:** must understand the app in seconds and be able to try room `0000`.

All are on a laptop in desktop Chrome, usually in the evening, singing aloud in front of a camera.

## Product Purpose
Karaoke Arena (brand: Aria) is a live, camera-on karaoke site. People see and hear each other, follow timed lyrics over an instrumental, and compete or collaborate in short vocal battles scored on pitch and tone. It began as a HackCMU (Multiplayer track) project. The backend, scoring and shared contract are done and hardened; this work redesigns the frontend (presentation only) so it feels smooth, polished and distinctive.

Success: a new signed-in user reaches singing in room `0000` in under 60 seconds; the lyric wipe stays within ±50 ms of audio; the play screen holds 60 fps; Lighthouse accessibility ≥ 90 on home, song select and results.

## Positioning
Two people sing the same 15-second chorus clip while watching each other live, judged by DSP pitch/tone numbers, with a one-line AI verdict that never replaces the score. A karaoke bar you can enter in 30 seconds.

## Operating Context
- Modes: Ranked 1v1 (Elo, K=32; private rooms are unrated), Duet (shared score, no Elo), Training (solo, live pitch visualizer), Chaos (public lounge, 1-8 feeds, no score).
- Room codes are 4 digits; `0000` is a permanent demo room.
- Seven songs in `apps/web/public/songs/`.
- Accounts are required (Supabase Google sign-in). Signed-out visitors can see home, leaderboard, stats, settings and legal pages only; `/play`, `/room/:code`, `/check` and `/training` are behind sign-in.
- Routes today: `/`, `/signin`, `/settings`, `/play`, `/play/:mode`, `/room/:code`, `/check`, `/check/voice`, `/training`, `/leaderboard`, `/stats`, `/privacy`, `/terms`; unknown paths redirect home. Dev-only: `/results-preview`, `/sync`, `/pitchtest`.
- Songs are picked inside the play and training flows; there is no standalone song-select route.

## Capabilities and Constraints
- Frontend only: React + Vite + TypeScript, plain CSS with tokens in `src/theme/theme.css`. No new styling library.
- Frozen: `packages/shared` (types, Socket.IO event names, constants), the server, DB, LiveKit, Supabase, PostHog and Gemini integrations, pitch tracking, DSP scoring and `melody.json`.
- Scoring path is unchanged: the browser computes the ScoreCard and POSTs it to `/api/turns/:roomId/score`. The DSP score is the judge of record and is always visually primary over the Gemini verdict.
- Lyric position comes from the audio clock, never timers.
- PostHog events that must keep firing: "play pressed", "mode selected", "training started", "share clicked".
- Desktop Chrome and dark mode only. No mobile layouts, no light mode.
- Must handle camera/mic states (prompt, denied, no device, device lost), LiveKit states (connecting, reconnecting, opponent dropped), and score submission states (loading, failure, retry).

## Brand Commitments
- Name: the product is "Aria" in the UI; "Karaoke Arena" is the project and repo name.
- The Aria blue brand in `docs/brand.md` is **replaced** by this redesign (owner decision, 2026-10-23); brand assets, `docs/brand.md` and the favicon get updated with it.
- Copy voice: dive-bar playful but restrained. Warm, a little cheeky, never themed to death.

## Evidence on Hand
- Existing app in `apps/web/src`, token layer in `src/theme/theme.css`, logo files in `public/brand/`, 7 songs with melody data.
- Absent, must not be fabricated: visual references, a Figma file, song cover images and bar-atmosphere backdrops (the owner generates these separately). Every image slot needs a token-based fallback so the UI is complete without them.

## Product Principles
- The lyric wipe is the most important visual in the app; everything on the play screen serves lyrics, camera feeds and scoring, in that priority.
- Menus, auth, settings and leaderboards are quiet and fast; intensity rises only in game moments (match intro, play, results).
- One system, one set of tokens, on every page.
- The score is primary; the verdict is garnish.
- If an element exists only to look "karaoke", remove it.

## Accessibility & Inclusion
- WCAG AA contrast for all text, including lyrics over camera feeds.
- Full keyboard navigation with visible focus on every page; focus management on route changes and modals.
- Respect `prefers-reduced-motion`: drop the intro, count-up and decorative transitions; keep the lyric wipe, without easing flourishes.
- Never use color alone for state (live, muted, your turn, winner); Player A/B must also differ by position and label.
