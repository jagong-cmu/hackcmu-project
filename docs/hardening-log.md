# Hardening log

Running record of the autonomous hardening pass (started 2026-10-13). One entry per fix: what, why, how it was verified.
Open items that need a product decision are listed at the bottom.

## 2026-10-13

### 1. Patch vulnerable server dependencies (`harden/deps`)
- `npm audit` (prod deps) reported 1 critical, 7 moderate, 1 low.
- Updated in place, lockfile only, within existing semver ranges: `proxy-addr` 2.0.8 (critical: IP spoofing via IPv4-mapped IPv6), `qs` 6.16.0 (array-limit bypass, DoS), `dompurify` 3.4.17.
- `npm audit fix` was not used. It also hoisted `react`/`react-router` copies to the root, which broke the typecheck.
- Remaining 5 moderate:
  - `react-router` 6.x open-redirect / constructor-injection advisories. The fix needs a major upgrade to v7, tracked below.
  - `@tensorflow/tfjs` → `argparse` / `sprintf-js`, a CLI-only dependency path that is never executed in the browser.
- Verified: typecheck, build, 154/154 tests.

### 2. Web: open redirect, security headers, debug routes, analytics scrubbing (`harden/web`)
Source: security audit of db7b8db (23 findings, ranked); this batch covers #7, #11, #22, #23.
- **Open redirect via `?next=` (medium).** `/check?next=%2F%5Cevil.com` and `/signin?next=/%09/evil.com` could send a user off-site, because react-router falls back to `location.assign` when `pushState` throws on a cross-origin URL. Now every `next` consumer goes through one helper, `apps/web/src/lib/safeNext.ts`. It rejects backslash and control characters (raw and decoded), requires a single leading `/` and checks the result is same-origin. Settings' `?next=` was previously unchecked and now uses it too.
- **Security headers (medium).** `vercel.json` `services.web.headers`: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, and a `Permissions-Policy` limiting camera and mic to self. A full CSP is drafted in `docs/csp-draft.md` but not enabled (open item).
- **Debug routes (low).** `/sync` and `/pitchtest` are now dev-only.
- **PostHog (low).** `before_send` strips OAuth `code`/`state`/`error*`/token params and URL hashes from captured URLs.
- Verified: typecheck, build, and 196/196 tests (42 new).

### 3. Server: crash safety, input coercion, client-trusted verdicts (`harden/server-crash`)
Audit findings #3 (high), #14, #18, #20 and #21.
- **Crash (high).** A signed-in user could crash a server instance, and every live match on it. One way was posting `{"displayName":{"a":1}}` to `/api/training/score`; an object-shaped room code (`{"toString":1}`) to `room:join` was another. Fixes:
  - every Express route is wrapped by `asyncRoute` (500 JSON, no internals)
  - every socket handler is wrapped by `safeHandler`
  - fire-and-forget promises get `.catch`
  - the 2s room sweep catches per room
  - process-level guards log and never exit
  - types are checked at every boundary
- **Verdicts (low).** The server no longer accepts `verdict`/`source` from the client. Gemini reads lyrics from the server's song pack when it is available (catalog-checked ids, no path traversal); otherwise posted lyrics are cleaned and capped.
- **Display names (low).** NFKC, control/format characters (bidi, zero-width) stripped, 16 chars, "Singer" fallback. Applied wherever a name is accepted or stored.
- **`pitch:live` (low).** At most 20/s per socket, and values are clamped before relay.
- **Stats/health (low).** `/api/stats` is cached for 60s. `/api/health` no longer discloses which integrations are configured.
- Verified: typecheck, build, 222/222 tests, the peer e2e socket suite (24 checks), and a live hostile-payload probe (server stays up).

## Open items (need a decision or larger change)
- Full Content-Security-Policy: draft in docs/csp-draft.md. Ship as Report-Only first.
- Song lyrics may not be bundled with the Vercel API function, so Gemini falls back to cleaned client lyrics. Add `includeFiles` for `apps/web/public/songs/*/lyrics.lrc` to the api service.
- react-router v6 → v7 upgrade to clear the remaining advisories. Our own `next=` handling goes through `safeNext`; check whether any `<Link>`/`navigate` takes user input.
