# ARIA design system: Midnight Stage

The shared foundation every screen builds on. **Source of truth:** `apps/web/src/theme/tokens.css` (tokens, fonts, type roles) and `apps/web/src/ui/` (shared components).

Who may edit what: [`ui-ownership.md`](./ui-ownership.md). The token file and shared components belong to QA. If you are a screen session and need a change there, write it in `docs/followups-<session>.md` and work around it locally until then.

Do not change audio capture, pitch detection, scoring, matchmaking, the note extraction tool, or note data.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#05070D` | page background (flat) |
| `--surface` | `#0D1220` | panels, rows, lane box, cards |
| `--text` | `#E8EEFF` | headings, primary text |
| `--muted` | `#8E9AB8` | secondary text, inactive items |
| `--red` | `#E5183B` | **you**: fills, your notes, primary button (`--on-red` white text) |
| `--red-text` | `#FF5C73` | small red text on dark |
| `--blue` | `#4D86FF` | **them / coming up**: opponent, upcoming notes |
| `--blue-text` | `#7FA8FF` | small blue text on dark |
| `--ice` | `#BBD0FF` | song numbers, playhead, highlights |
| `--line` | `rgba(140,170,255,0.2)` | borders, guides |

Derived roles, also in `tokens.css` and built only from the colours above:
- `--surface-2`: a raised surface for inputs and hover.
- `--line-soft` and `--line-strong`.
- `--scrim`: behind modals. `--shade`: chips over video.
- `--on-red`: white, the only text colour allowed on `--red`.
- `--red-hi`: primary button hover. It deepens rather than lightens, so the white text stays AA.
- `--you` (`--red`) and `--them` (`--blue`).
- `--*-rgb` channels for alpha variants, e.g. `rgb(var(--ice-rgb) / 0.1)`. There is one for every base colour except `--red-text` and `--blue-text`, including `--muted-rgb`.

**Rules**
- **Red = you. Blue = them / coming up.** Never decorative, never for "danger", "live" or "selected" when the thing isn't yours. If either side can be in a state (e.g. "live"), use `--ice` or the singer's own colour (`--feed-side`).
- **At most two blue UI elements per screen** outside the pitch lane.
- Proportions: roughly 70% black, 15% text and ice, 10% red, 5% blue.
- No gold or yellow anywhere. Old gold song numbers are `--ice`.
- No hex values outside `tokens.css`. There are two exceptions:
  - The Google "G" logo in `auth/GoogleButton.tsx` and its white disc in `auth/auth.css`, whose colours Google requires.
  - `results/cardPaint.ts`, because canvas cannot read CSS variables. Its constants mirror the tokens, and `canvasPalette.test.ts` fails if they drift.
  - Other canvas code reads tokens at runtime through `theme/palette.ts`.

**Contrast (WCAG AA)**, enforced by `theme/contrast.test.ts`:

| Text | on `--bg` | on `--surface` | on `--surface-2` |
|---|---|---|---|
| `--text` | 17.4 | 16.1 | 13.2 |
| `--muted` | 7.2 | 6.6 | 5.4 |
| `--red-text` | 6.7 | 6.3 | 5.1 |
| `--blue-text` | 8.6 | 8.0 | 6.5 |
| `--ice` | 13.0 | 12.1 | 9.9 |

- White text on `--red` is 4.64:1, and on `--red-hi` 5.91:1.
- `--red` and `--blue` as non-text fills are at least 3:1 on every ground (lowest: `--red` on `--surface-2`, 3.29:1).
- **Never put `--red` or `--blue` text on dark.** At small sizes `--red` is only 4.0–4.3:1. Use the `-text` variants.

## Fonts

- **Krona One** (400 only) is the display face. It is wide, so use it for short, important words and numbers only: logo, titles, menu items, tabs, numbers and scores.
- **Hanken Grotesk** (variable weight; we use 400, 600 and 700, plus italics) is for everything long: lyrics, song titles in lists, descriptions, buttons and body text.
- **Self-hosting:**
  - The files are in `apps/web/public/fonts/` under the OFL (licence files are there too).
  - Both are preloaded in `index.html` and use `font-display: swap`.
  - The fallbacks are Arial, metric-matched with `size-adjust` and ascent/descent overrides. These were measured in Chrome, so the swap barely moves text.
- `font-synthesis: none` is set on `:root`, so nothing ever fakes a Krona bold or italic. Setting `font-weight: 700` on Krona One does nothing; don't.
- **Tabular figures:**
  - Krona One has none: `font-variant-numeric: tabular-nums` changes nothing, and its "1" is 0.467em while the other digits are 0.5em.
  - Hanken's digits are already equal-width (0.56em).
  - Use `<Digits>` for any number that changes in place.

## Type scale

Use the role classes (`.t-logo` … `.t-label`). They set the family, size, weight, case and tracking together. The `--fs-*` / `--tr-*` tokens are there for custom CSS. Values below are desktop, with the under-600px value in brackets.

| Role | Face | Size | Notes |
|---|---|---|---|
| `.t-logo` | Krona One | 20px (16) | uppercase, tracking 0.12em |
| `.t-title` | Krona One | 44px (30) | screen titles, tracking 0.02em |
| `.t-menu` | Krona One | 36px (26) | primary menu items, 0.02em |
| `.t-menu-2` | Krona One | 16px (14) | secondary menu items, 0.06em |
| `.t-score` | Krona One | 44px (30) | scores, big numbers |
| `.t-num` | Krona One | 16px (14) | song numbers, 0.04em |
| `.t-tab` | Krona One | 12px (11) | mode tabs, badges, 0.08em |
| `.t-lyric` | Hanken 700 | 40px (24) | current lyric line |
| `.t-lyric-next` | Hanken 600 | 26px (18) | next line |
| `.t-desc` | Hanken 400 | 18px (16) | mode descriptions |
| `.t-body` | Hanken 400 | 16px (15) | body |
| `.t-song` | Hanken 700 | 15px (14) | song titles in lists, uppercase, 0.04em |
| `.t-label` | Hanken 600 | 12px (11) | labels, uppercase, 0.14em |

All Krona One roles are uppercase with line-height 1.05.

- **Existing screens** still use raw sizes from before the restyle (in `index.css`, `styles.css`, `theme/theme.css` and `results/results.css`). When you restyle a screen, move it to the roles above.
- Bebas Neue (the old display face) only had capitals, so every old display rule now sets `text-transform: uppercase` to keep the look. Krona One is about 1.6× wider than Bebas, so big display text may need a smaller size. The results headline was already brought down for this.

## Motion

- `--dur-fast` is 120ms, `--dur` 180ms and `--dur-slow` 300ms. `--ease` is `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Under `prefers-reduced-motion`, the global rule in `tokens.css` sets durations to zero, ends animations immediately and limits transitions to colour, background, border, opacity and outline. Transforms and slides become instant jumps, but state changes still show.
- Animate `transform` and `opacity` only. No per-frame blur and no `backdrop-filter`.

## Background

- Flat `--bg` everywhere, set on `:root`. `body` is transparent.
- `<Ambient />` (`ui/Ambient.tsx`) is the only decoration: two static radial gradients, a blue one at 20% top-right and a red one at 15% low.
  - It has `home` and `game` variants.
  - It is mounted once, app-wide, by `RouteAmbient` in `App.tsx`. `/room/*` and `/training` get `game`. Screens do not mount their own.
- **Removed:** the animated, blurred "Bloom" light field and the spark particles (`.sparks`, `.lyric-sparks`, `.score-burst`), components and CSS both.
- **Kept:** the `VoiceWave` waveform canvas (`theme/VoiceWave.tsx`). It is recoloured to `--ice` and `--text` through `palette()`, and capped at 25% opacity (12% for `.quiet`) in `theme.css`. Don't raise it.
- No `backdrop-filter` anywhere. Scrims use `--scrim`, panels `--surface`.

## Focus

Interactive elements get a 2px `--red-text` outline at a 3px offset (the global `:focus-visible` rule). For elements that clip outlines, use the `--focus-ring` box-shadow twin.

The one exception is `SelectableList`, where focus and selection are the same thing (roving tabindex). There, the red triangle plus the bright text is the indicator.

## Shared components (`apps/web/src/ui/`)

| Component | Use |
|---|---|
| `Button` | `<Button variant="primary" \| "secondary" \| "ghost" disabled>`. Primary is solid red with white Hanken 600, one per screen. Secondary is a `--line` outline on `--surface`. Hover, focus-visible (2px `--red-text` outline, 3px offset) and active (1px press) are built in. Styles are `.ui-btn` in `ui/ui.css`. The prefix keeps it clear of the legacy `.btn` text-link style and the `.cta` buttons, which were recoloured but not restyled. |
| `KeyHint`, `KeyHintBar` | `<KeyHintBar hints={[{ keys: ["Esc"], label: "Back" }]} />` is the footer row, fixed bottom-right. Inside the singing view the legacy `.stage.stage-fit > *` rule makes children `position: relative`; `machine.css` puts the bar back to `fixed` for `.km-page`, so do the same for any other `stage-fit` page. Without `hints` it shows the menu set (↑↓ Move, Enter Select, Esc Back). It is hidden under 600px, since phones have no keys. `<KeyHint>` is one keycap plus a label, for inline use. |
| `SelectableList` | Keyboard-first list or grid (details below). Used by the Home menu and the Training song grid. |
| `Panel` | `<Panel>` is `--surface`, a `--line` border, `--r-lg` and `--sp-5` padding. Don't nest Panels. |
| `Digits` | `<Digits value={87} />` puts each digit in a fixed 1ch cell (the width of "0", the widest digit in both faces), so scores and timers don't jiggle. It inherits font and colour, so pair it with `.t-score` or `.t-num`. Screen readers get the plain string. |
| `Img` | `<Img src={Images.mode.ranked} alt="" />`. If the file is missing or fails to load it renders **nothing**: no placeholder, no broken icon. Layouts must not depend on images being present. |
| `Ambient` | See Background. |

**`SelectableList`**
- Props are `items` (`{ id, label, desc?, secondary?, disabled?, content?, onActivate }`), `label` (its accessible name), `columns` (1 = vertical menu, more than 1 = grid), `initialId` (start on this item, e.g. the remembered one), `autoFocus` (focus the selected item once the items exist), `onSelectionChange`, `onBack` and `className`.
- Arrows move: a vertical list wraps, a grid moves in 2D and stops at the edges. Disabled items are skipped. Enter/Space activates, and Esc calls `onBack`.
- Hovering also selects, so mouse and keyboard never disagree.
- One red triangle slides between rows (transform only, `--dur` with `--ease`).
- Pass `content` to render a grid cell's own markup. Grid cells and `content` rows fill their track; plain labels stay text-width, so hovering empty space beside a menu item does not select it.
- The triangle is sized from the item's font (`0.42em`). Override `.your-list .sl-mark { width; height }` for a different size. The navigation logic is a pure function in `ui/menuNav.ts`, which has tests.

## Assets (`apps/web/src/ui/assets.ts`)

All files are under `apps/web/public/images/`, exported at 2× their display size. Everything must still work without them: render them only through `<Img>`, and give every `<Img>` a `width` and `height`.

| Constant | File | Shown at |
|---|---|---|
| `Images.heroHome` / `heroHome1x` | `hero-home.webp` (2752w) / `hero-home-1600.webp` | Home, right 58%, as a `srcset`; the CSS mask fades it into `--bg` on the left |
| `Images.heroRanked` / `heroRanked1x` (also `Duet`, `Training`, `Chaos`, `Room`, `Leaderboard`, `Settings`) | `hero-<mode>.webp` (2752w) / `hero-<mode>-1600.webp` | per-mode heroes, same framing as `hero-home`; Home doesn't swap to them yet |
| `Images.mode.ranked / duet / training / chaos / room` | `mode-<name>.webp`, 240×240 | Home, under the description (120px) |
| `Images.art[0..5]`, `artFor(songId)` | `art-01.webp` … `art-06.webp`, 96×96 | Training song grid (48px), lazy |
| `Images.stageBg` | `stage-bg.webp` | Behind the singing view at 30%, mounted by `MachineStage` |
| `Images.og` | `og.png`, 1200×630 | `og:image` and `twitter:image` in `index.html` |

There is no leaderboard art yet. Add `mode.leaderboard` when the file exists; until then the Home slot shows nothing and requests nothing.

**Backgrounds must be exactly `#05070D`.** Generated art comes back with a slightly lighter backdrop that shows as a box on the page. Fix the file rather than the CSS: pull the backdrop to `#05070D` and feather the outer edge into it. Never use blend modes.

## Note data (read-only for every session)

- **Per song**, `apps/web/public/songs/<id>/` holds `instrumental.mp3`, `lyrics.lrc`, `melody.json` and `meta.json`.
- **Song list:** `public/songs/manifest.json` (`{ "ready": [ids…] }`), loaded by `scoring/catalog.ts`.
- **`melody.json`**, the `MelodyFile` type in `packages/shared/src/types.ts`:
  - It holds `{ sampleRateHz: 50, startSec: number, hz: (number | null)[] }`. This is a fixed-rate pitch contour, not a list of notes.
  - Entry `i` is at `startSec + i / sampleRateHz` **seconds**.
  - Pitch is in **Hz**, and `null` means no singing.
  - Example from `creep`: `{"sampleRateHz":50,"startSec":0,"hz":[null,…,130.81,130.81,…]}`.
  - Look up a time with `melodyHzAt(melody, t)` in `scoring/scoreClip.ts`.
- **Notes for drawing** are `NoteRun` (`{ startSec, endSec, hz, midi }`). They are built at runtime by `segmentMelody` in `scoring/pitchGuide.ts`, not stored.
- **`meta.json`** is `SongMeta`: `id`, `title`, `artist`, `clipStartSec`, `clipDurationSec`, `firstLyricSec?`, `chorusSec?`, `duetClipStartSec` and `duetClipDurationSec` (plus `chaosDurationSec` on some songs).
- **`lyrics.lrc`** is standard LRC: `[mm:ss.xx]` per line, in hundredths of a second, with an optional duet part prefix: `[00:23.06]A: When you were here before` (the prefixes are `A:`, `B:` and `AB:`).
- All times everywhere are seconds.

**Not UI, owned by nobody, do not edit:**
- **Live pitch detection and scoring:** `scoring/crepePitch.ts` (CREPE, the main detector, with pitchy as fallback), `pitchGuide.ts`, `cents.ts`, `scoreClip.ts`, `hitGrade.ts`, `voiceRange.ts`, `catalog.ts`, `postScore.ts` and `cancelPlayback.ts`.
- **Note extraction:** `tools/note_extraction/` (Python pipeline) and `apps/web/scripts/extract-melody*.mjs`, `smooth-melody.mjs` and `rebuild-melodies.mjs`.
- `packages/shared/` and `server/`.
