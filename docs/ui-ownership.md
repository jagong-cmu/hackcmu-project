# UI file ownership for the restyle

Three screen sessions (A, B, C) restyle in parallel, each in its own worktree. **Each UI file has exactly one owner, and only that owner edits it.** That is the whole conflict-avoidance plan.

- **Need a change in a file you don't own?** Write it in `docs/followups-<session>.md` (e.g. `followups-b.md`), with the file, what to change and why. Then work around it in your own files.
- **QA** owns the shared foundation and merges followups.
- **Nobody** may edit the non-UI files at the bottom of this page.

Paths are relative to `apps/web/src/` unless noted. A file not listed belongs to the owner of the other files in its folder (e.g. `results/index.ts` → C, `lyrics/parseLrc.ts` → C); if a folder is split, ask QA. Design rules: [`design-system.md`](./design-system.md).

## QA: shared foundation (screen sessions must not edit)

| File | What |
|---|---|
| `theme/tokens.css` | every token, font face, type role class, focus and reduced-motion rule |
| `theme/components.css` | `.btn` / `.cta`, fields, `.feed` frame, shared component styles |
| `theme/palette.ts` | canvas colour reader (pitch lane reads tokens through this) |
| `theme/contrast.test.ts`, `results/canvasPalette.test.ts` | palette guards |
| `theme/DesignSystem.tsx` | `/system` reference page |
| `ui/Ambient.tsx`, `Button.tsx`, `Digits.tsx`, `Img.tsx`, `KeyHints.tsx`, `Panel.tsx`, `SelectableList.tsx`, `ui.css` | shared components |
| `ui/assets.ts` | image path constants |
| `ui/menuNav.ts` (+ test) | list/grid keyboard logic |
| `index.css`, `styles.css`, `theme/theme.css`, `theme/pages.css` | **legacy global sheets**, mixed rules for every screen. Read below. |
| `main.tsx`, `App.tsx` | CSS import order; routes (App stays a thin router) |
| `apps/web/index.html`, `apps/web/public/fonts/`, `apps/web/public/images/`, `apps/web/public/brand/` | font preloads, assets |

**The legacy sheets.** `index.css`, `styles.css`, `theme/theme.css` and `theme/pages.css` hold older rules for many screens at once. That makes them the biggest merge-conflict risk, so no screen session edits them.

- Put your screen's styles in **your own CSS file** (listed below, or a new one next to your component).
- If a legacy rule fights you, beat it with a more specific selector scoped to your screen root. Then list the legacy rule for deletion in your followups file.
- Note that CSS imported by a component loads *before* the sheets in `main.tsx`. Win on specificity, not order.

## A: home menu, leaderboard, settings, stats, room code entry, global nav/footer

| File | What |
|---|---|
| `home/MainMenu.tsx`, `home/mainMenu.css` | home menu (uses `SelectableList`) |
| `home/Play.tsx` | mode queue page and room-code join form (`/play/:mode`) |
| `ui/roomCode.ts` (+ test) | room code validation (in `ui/`, but owned by A) |
| `home/Settings.tsx`, `home/identity.ts` | settings, display name |
| `leaderboard/Leaderboard.tsx` | leaderboard |
| `leaderboard/ArenaStats.tsx` | stats |
| `theme/PageShell.tsx` | the page shell (title, back link, Esc hint) **shared with B's Training page**; A owns it |
| `theme/NotFound.tsx` | 404 |
| `legal/LegalLinks.tsx`, `legal/LegalPage.tsx`, `legal/legal.css` | global footer links, privacy and terms pages |
| `auth/SignIn.tsx`, `auth/AccountSection.tsx`, `auth/GoogleButton.tsx`, `auth/AuthProvider.tsx`, `auth/auth.css` | sign-in, account section in settings (`GoogleButton`'s logo colours are Google's and stay) |
| `onboarding/DeviceCheck.tsx`, `onboarding/VoiceCheck.tsx`, `onboarding/DeviceCheckGate.tsx`, `onboarding/deviceCheck.css` | mic and camera check, voice check (reached from settings and before a match) |

## B: training / song selection

| File | What |
|---|---|
| `training/Training.tsx` | training page layout. It renders C's lyrics, pitch lane, score HUD and results components. B places them but does not restyle them. |
| `training/SongPicker.tsx`, `training/songPicker.css` | the song list |
| `training/PitchTest.tsx`, `training/SyncLyrics.tsx` | dev-only tools (`/pitchtest`, `/sync`) |

## C: singing view and results

| File | What |
|---|---|
| `stage/Stage.tsx`, `stage/stage.css` | singing view layout |
| `stage/LaneBSlots.tsx`, `stage/slots.tsx` | glue that mounts lyrics, pitch lane and results into the stage. **It contains live grading calls (`gradeLive`, scoring state). Restyle only, and don't touch that logic.** |
| `stage/ClipTimer.tsx` | progress bar / timer |
| `stage/TurnBadge.tsx`, `stage/TurnOverlay.tsx`, `stage/CountdownOverlay.tsx` | in-game turn tabs and badges, countdown and versus intro |
| `stage/SafetyMenu.tsx` | per-tile report/mute menu |
| `media/VideoGrid.tsx` | camera/video tiles (the `.feed` frame styles are in QA's `components.css`, so request changes there) |
| `scoring/PitchMeter.tsx` | pitch lane (canvas). **Shared with B's Training; C owns it.** |
| `scoring/HitCallout.tsx`, `scoring/ScoreBars.tsx` | hit callouts, live score HUD. **Shared with Training; C owns them.** |
| `lyrics/LyricsOverlay.tsx`, `lyrics/lyrics.css`, `lyrics/rows.ts`, `lyrics/wipe.ts`, `lyrics/leadIn.ts`, `lyrics/duetParts.ts` | lyrics. **Shared with Training; C owns them.** The word wipe is switched off; `wipe.ts` is kept for later. |
| `results/ResultsModal.tsx`, `results/results.css`, `results/ShareSheet.tsx`, `results/ResultsPreview.tsx`, `results/ReelPreview.tsx` | results screen and share sheet. **`ResultsModal` is shared with Training; C owns it.** |
| `results/cardPaint.ts`, `composeShareImage.ts`, `matchMoment.ts`, `stageFrame.ts`, `reelOutro.ts`, `matchReel.ts`, `reelResults.ts`, `coachLine.ts`, `format.ts`, `scoreStatus.ts`, `useCountUp.ts`, `useMatchMoment.ts` | share card and match video painters. In `cardPaint.ts`, the palette constant block must keep matching `tokens.css`; the test enforces it. |

## Files two screens share (the one owner is in **bold**)

- **`theme/PageShell.tsx` (A)**: used by Settings, Leaderboard, Stats, Play, sign-in, device check, legal and 404, and by **B's Training**.
- **Owned by C, also rendered by B's Training:**
  - **`scoring/PitchMeter.tsx`**, **`scoring/ScoreBars.tsx`** and **`scoring/HitCallout.tsx`**
  - **`lyrics/*`**
  - **`results/ResultsModal.tsx`**
- **The `.feed` camera frame (QA, in `theme/components.css`)**: used by C's stage and the `/system` page.
- **`SelectableList` (QA)**: used by A's main menu, and available to B's song grid via `columns`.
- **`results/cardPaint.ts` (C)**: palette constants mirror QA's tokens.

## Not UI: owned by nobody, do not edit

| Path | Why |
|---|---|
| `scoring/crepePitch.ts`, `pitchGuide.ts`, `cents.ts`, `scoreClip.ts`, `hitGrade.ts`, `voiceRange.ts`, `catalog.ts`, `postScore.ts`, `cancelPlayback.ts` | pitch detection and scoring |
| `tools/note_extraction/` (repo root), `apps/web/scripts/extract-melody*.mjs`, `smooth-melody.mjs`, `rebuild-melodies.mjs`, `build-*.mjs` | note extraction tool |
| `apps/web/public/songs/` | note data, lyrics, audio |
| `rooms/`, `media/livekit.ts`, `useLiveKit.ts`, `audioContext.ts`, `levels.ts`, `rejoin.ts`, `useBlockedMedia.ts`, `stage/StageContext.tsx`, `useSharedClock.ts`, `rematchView.ts`, `takeKey.ts`, `leaveEffect.ts`, `formatCountdown.ts` | matchmaking, realtime and clock logic |
| `analytics/`, `auth/supabase.ts`, `account.ts`, `gis.ts`, `nonce.ts`, `signInFlow.ts`, `authMode.ts`, `lib/` | non-visual logic |
| `packages/shared/`, `server/` | protocol and server |
