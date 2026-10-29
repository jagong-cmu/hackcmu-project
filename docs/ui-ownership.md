# UI file ownership for the restyle

Three screen sessions (A, B, C) restyle in parallel, each in its own worktree branched from main. **Each UI file has exactly one owner, and only that owner edits it.** That is the whole conflict-avoidance plan.

- **Need a change in a file you don't own?** Write it in `docs/followups-<session>.md` (e.g. `followups-b.md`), with the file, what to change and why. Then work around it in your own files.
- **QA** owns the shared foundation and merges followups.
- **Nobody** may edit the non-UI files at the bottom of this page.

Paths are relative to `apps/web/src/` unless noted. A file not listed belongs to the owner of the other files in its folder; if in doubt, ask QA. Design rules: [`design-system.md`](./design-system.md).

**New files.** A session may add new files (components, CSS) inside its own folders, and owns what it adds. For example, B can add `training/training.css` and import it from `Training.tsx`.

## QA: shared foundation (screen sessions must not edit)

| File | What |
|---|---|
| `theme/tokens.css` | every token, font face, type role class, focus and reduced-motion rule |
| `theme/palette.ts` | canvas colour reader (the pitch lane and VoiceWave read tokens through this) |
| `theme/VoiceWave.tsx` | background waveform, used by Home, `PageShell` and Stage (capped at 25% opacity) |
| `theme/contrast.test.ts`, `results/canvasPalette.test.ts` | palette guards |
| `ui/Ambient.tsx`, `Button.tsx`, `Digits.tsx`, `Img.tsx`, `KeyHints.tsx`, `Panel.tsx`, `SelectableList.tsx`, `ui.css` | shared components |
| `ui/assets.ts` | image path constants |
| `ui/menuNav.ts` (+ test) | list/grid keyboard logic |
| `index.css`, `theme/theme.css` | **legacy global sheets**, mixed rules for every screen. Read below. |
| `main.tsx`, `App.tsx` | CSS import order; routes (App stays a thin router) |
| `apps/web/index.html`, `apps/web/public/fonts/`, `apps/web/public/images/`, `apps/web/public/brand/` | font preloads, assets |

**The two mixed legacy sheets.** `index.css` and `theme/theme.css` hold rules for nearly every screen (home, pages, buttons, lyrics, HUD, safety menu, phone layouts). That makes them the biggest merge-conflict risk, so no screen session edits them.

- Put your screen's styles in **your own CSS file**.
- If a legacy rule fights you, beat it with a selector scoped to your screen root. Then list the legacy rule for deletion in your followups file, and QA will delete it.
- Note that CSS imported by a component loads *before* the sheets in `main.tsx`. Win on specificity, not order.

## A: home menu, leaderboard, settings, stats, room code entry, global nav/footer

| File | What |
|---|---|
| `home/Home.tsx` | home screen (title, Play, top nav links) |
| `home/HomeHero.tsx` | Home hero image that follows the menu selection. `/play` redirects to Home (the old mode picker is gone). |
| `home/Play.tsx` | mode queue page and private-room create / room-code join (`/play/:mode`) |
| `home/Settings.tsx`, `home/identity.ts` | settings, display name |
| `leaderboard/Leaderboard.tsx` | leaderboard |
| `leaderboard/ArenaStats.tsx` | stats |
| `theme/PageShell.tsx` | page shell (title, back link) **shared with B's Training and others**; A owns it |
| `legal/LegalLinks.tsx`, `legal/LegalPage.tsx`, `legal/legal.css` | global footer links, privacy and terms pages |
| `auth/SignIn.tsx`, `auth/AccountSection.tsx`, `auth/GoogleButton.tsx`, `auth/AuthProvider.tsx`, `auth/auth.css` | sign-in, account section (the Google logo colours stay as they are) |
| `onboarding/DeviceCheck.tsx`, `onboarding/VoiceCheck.tsx`, `onboarding/DeviceCheckGate.tsx`, `onboarding/deviceCheck.css` | mic and camera check, voice range (reached from settings and before a match) |

## B: training and song selection

| File | What |
|---|---|
| `training/Training.tsx` | training page layout, including the song list. On main this is a `<select class="song-pick">` inside `Training.tsx`; there is no separate picker file yet, and B may add one. Its current styles are in QA's `index.css`. It renders C's lyrics, pitch lane, HUD and results components: B places them but does not restyle them. |
| `training/PitchTest.tsx`, `training/SyncLyrics.tsx` | dev-only tools (`/pitchtest`, `/sync`) |

## C: singing view and results

| File | What |
|---|---|
| `styles.css` | legacy sheet that is **all singing view**: stage layout, tiles, timer, turn guide, callouts, countdown, lyrics cue and next line, hit callout. C owns it. |
| `stage/Stage.tsx` | singing view layout |
| `stage/LaneBSlots.tsx`, `stage/slots.tsx` | glue that mounts lyrics, pitch lane and results into the stage. **It contains live grading calls and scoring state. Restyle only, and don't touch that logic.** |
| `stage/ClipTimer.tsx` | progress bar / timer |
| `stage/TurnBadge.tsx`, `stage/TurnOverlay.tsx`, `stage/CountdownOverlay.tsx` | in-game turn tabs and badges, countdown and versus intro |
| `stage/SafetyMenu.tsx` | per-tile report/mute menu (its styles are in QA's `theme.css` under "safety") |
| `media/VideoGrid.tsx` | camera/video tiles |
| `scoring/PitchMeter.tsx` | pitch lane (canvas). **Shared with B's Training; C owns it.** |
| `scoring/HitCallout.tsx`, `scoring/ScoreBars.tsx` | hit callouts, live score HUD. **Shared with Training; C owns them.** |
| `lyrics/LyricsOverlay.tsx`, `lyrics/duetParts.ts`, `lyrics/leadIn.ts`, `lyrics/parseLrc.ts`, `lyrics/index.ts` | lyrics. **Shared with Training; C owns them.** |
| `results/ResultsModal.tsx`, `results/results.css`, `results/ShareSheet.tsx`, `results/ResultsPreview.tsx`, `results/ReelPreview.tsx` | results screen and share sheet. **`ResultsModal` is shared with Training; C owns it.** |
| `results/cardPaint.ts`, `composeShareImage.ts`, `matchMoment.ts`, `stageFrame.ts`, `reelOutro.ts`, `matchReel.ts`, `reelResults.ts`, `coachLine.ts`, `useCountUp.ts`, `useMatchMoment.ts`, `index.ts` | share card and match video painters. In `cardPaint.ts`, the palette constant block must keep matching `tokens.css`; the test enforces it. |

## Files two screens share (the one owner is in **bold**)

- **`theme/PageShell.tsx` (A)**: used by Settings, Play, Leaderboard, Stats, sign-in, legal, device and voice check, and by **B's Training and PitchTest**.
- **Owned by C, also rendered by B's Training:**
  - **`scoring/PitchMeter.tsx`**, **`scoring/ScoreBars.tsx`** and **`scoring/HitCallout.tsx`**
  - **`lyrics/LyricsOverlay.tsx`**
  - **`results/ResultsModal.tsx`**
- **`theme/VoiceWave.tsx` (QA)**: background on Home, every `PageShell` page and Stage.
- **`index.css` / `theme/theme.css` (QA)**: legacy rules for all three screens.
- **`results/cardPaint.ts` (C)**: palette constants mirror QA's tokens.

## Not UI: owned by nobody, do not edit

| Path | Why |
|---|---|
| `scoring/crepePitch.ts`, `pitchGuide.ts`, `cents.ts`, `scoreClip.ts`, `hitGrade.ts`, `voiceRange.ts`, `catalog.ts`, `postScore.ts`, `cancelPlayback.ts`, `scoring/index.ts` | pitch detection and scoring |
| `tools/note_extraction/` (repo root), `apps/web/scripts/` | note extraction tool |
| `apps/web/public/songs/` | note data, lyrics, audio |
| `rooms/`, `media/livekit.ts`, `useLiveKit.ts`, `audioContext.ts`, `levels.ts`, `rejoin.ts`, `useBlockedMedia.ts`, `stage/StageContext.tsx`, `useSharedClock.ts`, `rematchView.ts`, `useRematchView.ts`, `takeKey.ts`, `leaveEffect.ts`, `formatCountdown.ts` | matchmaking, realtime and clock logic |
| `onboarding/deviceCheck.ts`, `onboardingState.ts`, `accountOnboarding.ts`, `voiceProfile.ts` | onboarding logic |
| `analytics/`, `auth/supabase.ts`, `account.ts`, `gis.ts`, `nonce.ts`, `signInFlow.ts`, `authMode.ts`, `legal/contact.ts`, `content.ts`, `render.ts`, `lib/` | non-visual logic and legal text |
| `packages/shared/`, `server/` | protocol and server |
