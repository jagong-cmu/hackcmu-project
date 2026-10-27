# Aria brand sheet

Direction: **Korean karaoke rooms (noraebang), late at night.** The room is the identity and the feedback: each mode has its own full-screen room, and the room reacts live to how well you sing. On top sits a plain, quiet game-menu UI. Product truth and decisions: `apps/web/PRODUCT.md`. Spec: SPEC2 (2026-10-23).

**Source of truth: `apps/web/src/theme/tokens.css`.** Colour, type scale, spacing, radius, shadow and motion all live there; component CSS references tokens only. `/system` (dev server only) renders the tokens and core components.

## The room

- Four rooms, one per mode: **Ranked** (small two-person booth), **Duet** (cozy, shared couch), **Training** (small solo room, calm), **Party** (Chaos: largest room, most lights). Mapping lives in `src/scene/rooms.ts`; room 0000 and private rooms use their own mode's room; sign-in, settings, errors and other non-game pages use the Ranked room, darkened.
- Images are supplied by the owner under `apps/web/public/rooms/` (see the README there for names, sizes and the readability requirement). The app works without them: every page falls back to the solid maroon-black `--ink`. Open `/scene-check` on the dev server to measure delivered files against the brief.
- Layers, bottom to top: solid ground, blurred placeholder, full image, **reactive light** (edges only), scrim, page dimming. Decorative and hidden from assistive tech.
- Main menu: the backdrop crossfades (about 360 ms) to the selected mode's room, starting only after the selection has rested 150 ms.

## The reactive light layer

- Input: the live singing accuracy the browser already computes (a hit grade per frame). Read-only; it never writes to scoring. Ranked reacts **only to your own take** (the game hides the opponent's live numbers until the match ends, so the room idles neutral on their turn); Duet blends both singers; Training is your own; Chaos follows how busy the melody is; Results settle at the final score.
- Output: one smoothed 0..1 intensity (`src/scene/intensity.ts`) driving disco-spot count and speed, edge warmth, and the TV glow. It responds within 150 ms, settles slowly, and cannot flash: after any change of direction it will not reverse for 250 ms (at most 2 flashes a second, inside WCAG 2.3.1's limit of 3).
- The light is masked to the edges, and a hole is cut around the measured lyric rows and feeds, so the area behind lyrics and faces never changes brightness.
- Reduced motion: spots stay put; intensity shows only as a slow brightness fade.

## Colour

| Role | Token | Notes |
| --- | --- | --- |
| Ground | `--ink` | Deep maroon-black. Also the fallback when a room image is missing. |
| Text | `--fg`, `--fg-dim`, `--fg-faint` | Warm off-white. `--fg-faint` is the contrast floor. |
| Accent | `--accent` (`--red-400`), `--accent-fill` | The one UI accent: selection indicator, primary buttons, "live". Buttons use the darker `--accent-fill` under `--on-accent`. |
| Secondary | `--gold-*` | Soft gold for scores, ranks, the sung part of a lyric. |
| Light layer | `--spot-1` … `--spot-5` | The only multicolour in the app (and song covers). Never UI chrome. |
| Players | `--player-a` gold, `--player-b` off-white | Also distinguished by position (opponent left, you right) and labels. |

Avoid: purple-to-blue gradients, glassmorphism, glows on UI elements, rainbow neon. State is never colour alone: LIVE, YOU, WIN, signed Elo are all words or signs.

## Type

- **Display** (menu items, headings): Barlow Condensed 600/700/800, uppercase for menu and page titles.
- **UI and lyrics**: Figtree 400–800. Lyrics are Figtree 800 with a dark outline: the largest text on the play screen.
- Both load from Google Fonts in `apps/web/index.html`.

## Signature elements

- **Lyrics**: two rows, alternating (top row left, bottom row right), white with a dark outline; each word fills gold left to right as it is sung, driven by the audio clock (`src/lyrics/wipe.ts`, `rows.ts`).
- **Menu**: a left-aligned list with one small red indicator that moves instantly; key hints bottom-right ("Enter Select", "Esc Back").
- **Score reveal**: a big 0–100 number counting up with one short beat, then the Elo change, with the verdict as a quiet line under it.
- **Songbook**: each song has a display number (001–007), cover slot (`/songs/<id>/cover.jpg`, optional) and title/artist.

## Not in v1

Rank-based rooms, machine-styled controls (keypad, LED panels), clickable objects in the room, any real karaoke brand's names, logos or screen layouts.

## Logo and icons (pending)

`apps/web/public/brand/` (wordmark, mark, favicon, social cards) is still the retired blue "Wave A" set and needs redrawing for this direction.
