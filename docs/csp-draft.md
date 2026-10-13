# Content-Security-Policy draft (NOT enabled)

Status: **draft for review.** Production currently ships only
`Content-Security-Policy: frame-ancestors 'none'` (plus `X-Frame-Options`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`) from `services.web.headers`
in `vercel.json`. A full policy needs a deliberate rollout because Google
Identity Services, Supabase, LiveKit, PostHog, TensorFlow.js model loading and
Google Fonts all have to be allow-listed exactly.

## Where the app actually loads from

Gathered by grepping `apps/web/src`, `apps/web/index.html` and the `VITE_*`
env names. Re-grep before enabling; anything new will break silently.

| Origin | Used for | Code | Directives |
|---|---|---|---|
| `'self'` | SPA bundle, `/api/*` fetches, `/songs/*` audio + manifest, `/brand/*` icons, Socket.IO (same-origin unless `VITE_SOCKET_URL` is set) | everywhere | `default-src`, `script-src`, `style-src`, `img-src`, `media-src`, `connect-src`, `manifest-src` |
| `https://accounts.google.com` | GIS script `https://accounts.google.com/gsi/client`, One Tap / button iframe, GIS stylesheet `https://accounts.google.com/gsi/style`, OAuth redirect | `auth/gis.ts` (`GIS_SRC`), `auth/GoogleButton.tsx` | `script-src`, `frame-src`, `style-src`, `connect-src`, `form-action` |
| `https://<project>.supabase.co` (`VITE_SUPABASE_URL`) | Auth REST (`/auth/v1/*`), `updateUser`, session refresh; realtime would be `wss://` | `auth/supabase.ts`, `auth/AuthProvider.tsx`, `rooms/socket.ts` | `connect-src` (https + wss) |
| LiveKit Cloud: `wss://<project>.livekit.cloud` and `https://<project>.livekit.cloud` (`LIVEKIT_WS_URL` / `VITE_LIVEKIT_WS_URL`; the token endpoint returns the URL) | Signalling websocket, region discovery (`/settings/regions`), and regional edge hosts (`*.livekit.cloud`) | `media/livekit.ts`, `server/src/livekit.ts` | `connect-src` (`wss://*.livekit.cloud https://*.livekit.cloud`). Media itself is WebRTC (not governed by CSP). |
| PostHog `VITE_PUBLIC_POSTHOG_HOST` (default `https://us.i.posthog.com`) + `https://us-assets.i.posthog.com` (lazy-loaded extensions: surveys, toolbar, web-vitals, etc.) | Event capture, flags, remote config | `analytics/posthog.ts` | `connect-src`, `script-src` (assets host) |
| `https://fonts.googleapis.com` | Google Fonts CSS (Bebas Neue, Outfit) | `index.html` | `style-src` |
| `https://fonts.gstatic.com` | Font files | `index.html` | `font-src` |
| `https://cdn.jsdelivr.net` | CREPE pitch model (`model.json` + weight shards) for TensorFlow.js | `scoring/crepePitch.ts` | `connect-src` |
| `https://lh3.googleusercontent.com` (if avatars are ever shown) | Google profile pictures | not rendered today | `img-src` (add only if used) |
| `blob:` | Share video/image (`URL.createObjectURL` in `results/matchReel.ts`, `results/matchMoment.ts`, `results/ResultsModal.tsx`), downloads, LiveKit/MediaRecorder output | results/* | `img-src`, `media-src` (and `worker-src blob:` if livekit E2EE/workers are ever enabled) |
| `data:` | Inline SVG/PNG data URIs (Vite may inline small assets; canvas `toDataURL`) | build output, results/* | `img-src`, `font-src` (Vite-inlined fonts) |

Notes:

- TensorFlow.js uses the `webgl` backend with a `cpu` fallback; neither needs
  `'unsafe-eval'`. If the wasm backend is ever added, `'wasm-unsafe-eval'` is
  required in `script-src`.
- React `style={...}` props are applied via CSSOM and are not blocked by
  `style-src`, but GIS and some libraries inject `<style>` elements, so
  `'unsafe-inline'` in `style-src` is the pragmatic starting point.
- `index.html` has no inline `<script>`; Vite emits external module scripts,
  so `script-src` can avoid `'unsafe-inline'`.
- The static legal pages (`dist/privacy/index.html`, `dist/terms/index.html`)
  are built from the same template, so the same policy applies.

## Proposed policy (Report-Only first)

Replace `<supabase-project>` with the host from `VITE_SUPABASE_URL` and
`<livekit-project>` with the host from `LIVEKIT_WS_URL` (or keep the
`*.livekit.cloud` wildcard, since LiveKit Cloud may connect to regional hosts).

```
default-src 'self';
script-src 'self' https://accounts.google.com/gsi/client https://us-assets.i.posthog.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https://*.googleusercontent.com;
media-src 'self' blob:;
connect-src 'self'
  https://<supabase-project>.supabase.co wss://<supabase-project>.supabase.co
  https://*.livekit.cloud wss://*.livekit.cloud
  https://us.i.posthog.com https://us-assets.i.posthog.com
  https://accounts.google.com/gsi/
  https://cdn.jsdelivr.net;
frame-src https://accounts.google.com/gsi/;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self' https://accounts.google.com;
frame-ancestors 'none';
upgrade-insecure-requests
```

If `VITE_SOCKET_URL` points at a different origin, add both its `https://` and
`wss://` forms to `connect-src`.

## Rollout

1. Ship the policy as `Content-Security-Policy-Report-Only` (keep the existing
   enforced `frame-ancestors 'none'` header alongside it) in
   `services.web.headers` in `vercel.json`, optionally with a `report-to`
   endpoint.
2. Exercise every flow in Chrome with DevTools open: Google One Tap + button
   sign-in, redirect sign-in, `/check` (mic + camera), voice check, ranked +
   duet match over LiveKit, results share video/image download, leaderboard,
   training (CREPE model load), `/privacy`, `/terms`. Fix any violations.
3. Switch the header name to `Content-Security-Policy`.
