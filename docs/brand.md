# Aria brand sheet

Direction: a late-night karaoke bar, with restraint. A warm brown-black room lit by one tungsten bulb. Decision log and rationale: `apps/web/PRODUCT.md`. Redesign spec: step 1 of the frontend redesign (2026-10-23).

**Source of truth: `apps/web/src/theme/tokens.css`.** Colour, type scale, spacing, radius, shadow and motion all live there; component CSS references tokens only. Core components live in `apps/web/src/theme/components.css`. `/system` (dev server only) renders all of them.

## Colour

| Role | Token | Notes |
| --- | --- | --- |
| Room | `--ink` `#0f0b08` | Warm near-black. Never pure `#000`, never blue-grey. |
| Surfaces | `--surface`, `--surface-2`, `--surface-3` | Booth, raised, hover. Panels never nest. |
| Text | `--fg`, `--fg-dim`, `--fg-faint` | Off-white cream. `--fg-faint` is the contrast floor (4.9:1). |
| Primary | `--accent` = `--amber-400` `#f5a21f` | Tungsten. One amber thing per screen: the primary action, or the sung part of a lyric. |
| Neon | `--neon` `#ff4f9a` | Live, active, or "you" only. Never decorative. |
| Players | `--player-a` amber, `--player-b` steel `#9fc6e4` | Also marked by position (A left, B right) and a label. |
| Status | `--positive`, `--warning`, `--danger` | Always paired with text or a sign. |

Avoid: purple-to-blue gradients, glassmorphism, glows on every element, rainbow neon. Alpha variants use channel tokens (`rgb(var(--amber-rgb) / 0.4)`), never raw values.

## Type

- **Display and lyrics:** Familjen Grotesk 500/600/700 (`--font-display`).
- **UI and body:** Figtree 400/500/600 (`--font-ui`).
- Lyrics are the largest text on the play screen (`--text-lyric`).
- Both load from Google Fonts in `apps/web/index.html`.

## Motion

Menus, settings, auth, leaderboards and inputs are instant or near-instant (`--dur-fast`). Motion is spent on the lyric wipe, the match intro, the countdown and the score reveal. `prefers-reduced-motion` drops everything decorative.

## Logo and icons (pending)

`apps/web/public/brand/` (wordmark, mark, favicon, social cards) is still the retired blue "Wave A" set and needs redrawing in the warm palette.
