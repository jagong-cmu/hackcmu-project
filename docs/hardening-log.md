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

### 4. Abuse limits, low-risk part: room-code brute force, auth amplification, safety limiter bounds (`harden/abuse-limits-safe`)
Audit findings #4 (high), #8, #16 and #17. New module `server/src/abuseLimits.ts`.
- **Private room brute force (high, #4).** Private codes stay 4 digits (product decision), so a miss now reveals nothing and misses are limited:
  - `room:join` and `chaos:join` answer one `ROOM_UNAVAILABLE` error for a private code that doesn't exist, is full, or is the wrong mode. Before, `ROOM_NOT_FOUND`, `ROOM_FULL` and `NOT_CHAOS` told them apart. The copy is "Can't join room 1234. Check the code. The room may be full or closed." The client shows the server's message, so no web copy changed. The demo room and public `chaos-N` lounges keep their specific errors.
  - Failed joins are limited per verified account (per socket in the dev opt-out). After 8 distinct failed codes in 5 minutes there is a 5-minute cool-down (`JOIN_RATE_LIMITED`, "Too many room codes tried. Wait N minutes and try again."). During the cool-down, joins to private codes are refused before any lookup. Successful joins and repeats of an already-counted code are free, so the Stage's 800ms join retry never trips it. Opening a fresh private lounge with `chaos:join <code>` counts as a miss, because the web client uses `room:create` for that.
  - Not in this entry: `GET /api/rooms/:code` and `/api/livekit/token` still tell "no such room" apart from "not yours" (entry 5).
- **Supabase verification amplification (#8).**
  - Tokens are screened locally first: anything that isn't a three-part JWT with a future `exp` (60s skew) is refused without a network call.
  - Tokens Supabase rejects with a 4xx are cached for 60s. The cache is keyed by SHA-256 of the token and capped at 5000 entries. Network errors and 5xx are never cached.
  - `player:hello` may trigger at most 5 verifications per socket per 30s. Hellos from an already-verified socket don't count.
- **Report + block (#16).** "Report and block" now goes through `block()`, so `MaxBlockedPlayers` and `BlockLimit` apply. If the block is refused, the report still goes in and the ack says why it wasn't blocked.
- **Unbounded maps (#17).** `RateLimiter` sweeps keys whose hits have all aged out and caps itself at 10k keys, evicting the least recently used first. The report de-dupe set is now a map with a 24h TTL, capped at 20k entries.
- **Per instance.** Every limit here is per server instance. On Vercel the effective limit is the limit times the number of live instances (open item).
- Verified: typecheck, build, 242/242 tests (20 new), and the peer e2e socket suite (24/24). `abuseLimits.test.ts` starts real servers, in the dev opt-out and in verify mode against a stub Supabase that counts calls.

## Open items (need a decision or larger change)
- Rate limits are per instance (room joins, hello verification, reports, blocks, votes). A shared limiter (Mongo TTL collection or Upstash) would make them global on Vercel.
- Private room codes are 4 digits. The join limit makes guessing slow, but a longer code (or a 6-digit option for private rooms) would make it impractical.
- A fresh handshake per connection can still cost one Supabase call per unique, well-formed but forged JWT. A per-IP connection limit (e.g. Vercel WAF rate limit on `/socket.io`) would cap it.
- Full Content-Security-Policy: draft in docs/csp-draft.md. Ship as Report-Only first.
- Song lyrics may not be bundled with the Vercel API function, so Gemini falls back to cleaned client lyrics. Add `includeFiles` for `apps/web/public/songs/*/lyrics.lrc` to the api service.
- react-router v6 → v7 upgrade to clear the remaining advisories. Our own `next=` handling goes through `safeNext`; check whether any `<Link>`/`navigate` takes user input.
