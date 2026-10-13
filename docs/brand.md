# Aria brand sheet

Logo: **Wave A**. The Bebas Neue A from the wordmark, with its crossbar replaced by the voice wave from `theme/VoiceWave.tsx`.
Assets live in `apps/web/public/brand/` and are served at `/brand/...`. Direction: Wave A.

## Colour

The brand is dark-first. It uses one ground colour and one blue light source, and its tokens are the ones already defined in `src/theme/theme.css`.

| Role | Token | Hex |
| --- | --- | --- |
| Ground (page, icon tiles, theme-color) | `--ink` | `#04060c` |
| Raised surface | `--surface-2` | `#0c1320` |
| Deepest blue | `--blue-800` | `#0d2551` |
| | `--blue-600` | `#1b4fa3` |
| Mark feet (dark ground) / wave (light ground) | `--blue-500` | `#2f74d8` |
| | `--blue-400` | `#4f97f5` |
| Accent | `--blue-300` / `--accent` | `#79b4ff` |
| Secondary voice ribbon | `--blue-200` | `#a8d0ff` |
| | `--blue-100` | `#d3e7ff` |
| Mark apex, white-hot | `--blue-050` | `#f2f8ff` |
| Wordmark, primary wave | `--fg` | `#ffffff` |

**Brightness by height.** On dark grounds the mark's legs run from blue-500 at the feet to blue-050 at the apex. That is the same rule `pitchColor()` uses for notes. On light grounds the ramp inverts, going from blue-600 to ink.

**Glow.** The files ship flat. Add the glow in context, the way the site does:
`filter: drop-shadow(0 0 14px rgba(255,255,255,.3)) drop-shadow(0 0 50px rgba(168,208,255,.45)) drop-shadow(0 0 110px rgba(79,151,245,.4))`.

There is no gold, pink, cyan or spectrum. Warm colours are kept for warnings and errors only.

## Type

- **Display:** Bebas Neue 400, all caps. The ARIA wordmark is Bebas Neue outlines tracked **0.26em**, which matches `.wordmark` on Home. Every SVG uses paths, so none of them need the font.
- **UI / body:** Outfit 400 / 500 / 600.

## Logo files (`logo/`)

| File | Use |
| --- | --- |
| `mark.svg` | Primary mark on dark. Square, 760 viewBox. |
| `mark-light.svg` | Mark on white or light grounds. |
| `mark-small.svg`, `mark-small-light.svg` | Simplified mark for 48px and below: single wave, no gap mask, heavier crossbar. |
| `mark-mono-white.svg`, `mark-mono-black.svg` | Single colour. |
| `wordmark.svg`, `wordmark-ink.svg` | ARIA alone, white or ink. |
| `wordmark-signature.svg` (+`-light`) | ARIA whose first A is the mark. Best for hero, social and signage. |
| `lockup-horizontal.svg` (+`-light`) | Mark + wordmark side by side. |
| `lockup-stacked.svg` (+`-light`) | Mark above wordmark. |
| `mono-white.svg`, `mono-black.svg` | Horizontal lockup in one colour. |
| `splash.svg` | Animated (SMIL) loading mark. Works as a plain `<img>`. |

## Clear space and minimum size

- **x** = the leg width of the A, about 1/6 of cap height. Keep at least **x** clear on every side of any lockup, and **2x** around the mark when it's used as an app icon.
- Mark: **16px** minimum. Use `mark-small.svg` at 48px and below.
- Wordmark: **64px** wide minimum. Horizontal lockup: **120px** wide minimum. Stacked: **56px** wide minimum.

## Do / don't

Do
- Use it on the night ground (`#04060c`) with bloom and glow. That's the primary use.
- Use `-light` files on white, and mono files for one-colour reproduction.
- Use the signature wordmark when there is room for only one brand element.

Don't
- Recolour the mark outside the blue ramp, or add gradients that aren't brightness-by-height.
- Retype ARIA in another font or change the tracking.
- Set the mark directly before the wordmark at cap height, where it reads as "A ARIA". Use the lockups.
- Use dark-ground files on light backgrounds, or bake glow into exported files.
- Rotate, outline, or animate the legs. Only the wave moves.

## Web assets

| File | Size | Notes |
| --- | --- | --- |
| `favicon.svg` | vector | Transparent; switches palette with `prefers-color-scheme`. |
| `favicon.ico` | 16 / 32 / 48 | Dark rounded tile. |
| `favicon-16.png`, `favicon-32.png`, `favicon-48.png` | px | Dark rounded tile, alpha corners. |
| `apple-touch-icon.png` | 180×180 | Opaque, full bleed; iOS rounds it. |
| `icon-192.png`, `icon-512.png` | px | PWA `any`; rounded tile with alpha corners. |
| `icon-maskable-512.png` | 512×512 | PWA `maskable`; full bleed, mark inside the 80% safe circle. |
| `site.webmanifest` | | name/short_name "Aria", theme + background `#04060c`. |
| `social/og-image.png` | 1200×630 | Open Graph. |
| `social/twitter-card.png` | 1200×600 | `summary_large_image`. |

PNG render sources live in `src/` (`icons.html`, `og.html`, `twitter.html`). Open them at the stated size and screenshot the element to regenerate.

## Wiring (in apps/web/index.html)

```html
<link rel="icon" href="/brand/favicon.ico" sizes="48x48">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">
<meta name="description" content="1v1 karaoke. Same chorus. They watch you.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Aria">
<meta property="og:title" content="Aria">
<meta property="og:description" content="1v1 karaoke. Same chorus. They watch you.">
<meta property="og:image" content="https://karaoke-arena.vercel.app/brand/social/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Aria: 1v1 karaoke. Same chorus. They watch you.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Aria">
<meta name="twitter:description" content="1v1 karaoke. Same chorus. They watch you.">
<meta name="twitter:image" content="https://karaoke-arena.vercel.app/brand/social/twitter-card.png">
```
