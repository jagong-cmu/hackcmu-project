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

### 5. Server: score integrity and single ELO settlement (`harden/score-integrity`)
Audit findings: client-trusted scores (critical) and double ELO settlement across instances (high).
- **Scores.** `overall` is recomputed on the server from pitch and tone with the shared `overallFrom` (`packages/shared/src/scoring.ts`); a silent take stays 0. `POST /api/turns/:roomId/score` takes one card per seat per match (`Room.matchId`), and only after that seat's clip is over. That means ranked seat A from swap on, or at turnA's clip end minus 1.5s; seat B in results, or at turnB's clip end minus 1.5s. Duet takes it in results, or at the live clip end minus 1.5s. Refusals return 409 with one of these codes:
  - `MATCH_NOT_STARTED`
  - `TURN_NOT_ENDED`
  - `STALE_MATCH`
  - `MATCH_SETTLED`
  - `SCORE_ALREADY_RECORDED`
  - `NOT_A_SINGER`
  - `NOT_A_SCORED_MATCH`
- **Across isolates.** Each card is claimed with a conditional write into `liveRooms.matchScores`, keyed by matchId. Whole-snapshot saves no longer write scores, so a stale isolate cannot erase or replace a card.
- **Settlement.** `finishMatch` atomically claims `settledMatchId` on the `liveRooms` doc before it persists anything. Only the winning instance rates the match. The others take the result it publishes and emit the same `match:over`. On top of that, `matches` has a unique partial index on `{roomId, matchId}`, and the doc is inserted *before* ELO moves. A second settlement therefore hits E11000 and applies nothing. Without Mongo, behaviour is unchanged: there is a single instance.
- **Client.** It echoes `matchId` and treats 409s as final, except `TURN_NOT_ENDED`, which retries after a pause. A room update can no longer restart a take whose score is in flight.
- Verified: typecheck, build, and 240/240 tests (18 new, including a two-isolate settlement race on an in-memory Mongo). Also the peer e2e suite, and a two-socket ranked match. In that match, early, duplicate and post-settlement posts were refused, and it settled once at +16/−16.
### 6. Abuse limits, needs review: room snapshots, socket token expiry, LiveKit token life (`harden/abuse-limits-review`, stacked on entry 4)
Audit findings #5, #12 and #19, plus a second room-existence oracle found while fixing #4.
- **LiveKit token endpoint (#4 follow-up).** `/api/livekit/token` answered 404 for "no such room" and 403 for "not seated", with no limit, so it could enumerate private codes on its own. Both now get `403 NOT_SEATED`. The client already retries on both codes.
  - The peer e2e suite's "unknown room is refused" check expects 404, so it now fails by design. Every other check passes.
- **Room snapshots (#12).** `GET /api/rooms/:code` only answers callers seated in that room. Everyone else gets the same 404 as a code that doesn't exist. The `pruneRoom`/`advanceDue` side effects now run only for seated callers.
  - RoomProvider is the only caller. It polls `/room/:code` before `room:join` has seated it, and right after a join that landed on another instance. In both windows it already ignores non-OK responses, and `room:state` over the socket covers them.
  - In the dev opt-out the poll sends `X-Client-Id` so local play still works.
- **Sockets authorised forever (#19).** The verified token's `exp` is now stored on the socket.
  - Once `exp` plus 30s has passed, `player:hello` re-verifies from the `accessToken` it carries. The in-room heartbeat sends one every 12s.
  - If re-verification fails, the socket is signed out, and play events (`queue:join`, `room:create`, `room:join`, `chaos:join`, `room:ready`, rematch) answer `AUTH_REQUIRED`. The client already recovers from that by refreshing its session.
  - The seat is kept, so nobody forfeits. `pitch:live` and safety events are not gated: they only act inside a room the socket is already seated in.
- **LiveKit tokens (#5).** The TTL is down from 2h to 15 min. LiveKit tokens can't be revoked, so leaving now ends the media session as well (best-effort `removeParticipant`, logged at most every 30s):
  - straight away on `room:leave`, switching rooms, queueing, a safety leave or an ejection
  - 20s after a socket disconnect, and only if the player hasn't re-seated in that room by then
  - A connected participant is unaffected by token expiry, because LiveKit pushes refreshed tokens to live connections. `useLiveKit` now rejoins with a freshly minted token after an unexpected disconnect (up to 5 times per stage, with backoff, never after leaving on purpose). The server refuses that token if the player is no longer seated or was removed.
- **Why held for review.**
  - The token endpoint now returns a different status.
  - Expiry gating could briefly return `AUTH_REQUIRED` to a backgrounded tab still holding a stale token.
  - The delayed media drop may not fire on Vercel.
  - The client rejoin logic is covered by unit tests only, not tried in a browser.
- Verified:
  - typecheck and build
  - 251/251 tests, 9 more than entry 4
  - the peer e2e socket suite: 23/24, the one failure being the expected LiveKit 404 → 403 change
  - a full ranked match over two sockets, with the same results as main

### 7. Product: private Ranked rooms are unrated; report-then-leave is a forfeit (`feat/private-unrated-report-forfeit`)
Product decisions closing the "private ranked rooms are rated" open item and audit findings #6 (report-then-leave dodges ELO) and #13 (host/private flag per instance).
- **Friendly rooms.** A Ranked room made with `room:create` plays exactly like Ranked but never moves ELO.
  - `Room.rated` (plus `isPrivate`, `hostId`) is set when the room is made and kept by `resetToLobby`, so a rematch stays unrated. Queue rooms and `0000` stay rated.
  - All three are in the `liveRooms` snapshot, so every instance agrees. They only ever move toward private/unrated in `applySnap`, so a stale snapshot cannot re-rate a friendly room or hand it a new host.
  - Old snapshots without the fields: a room this instance already knows keeps its flags. A room first built from an old snapshot is rated, public and hostless, which is the behaviour before this change. Rooms live at most 2h, so this only matters during the deploy.
  - `finishMatch` skips ELO for unrated rooms, including forfeits and the cross-instance claim path (the claim winner publishes the unrated result; losers converge on it). It still writes a `matches` doc with `rated: false` and `eloDelta: null`, and never touches `players.elo` or `matchesPlayed`. `/api/stats` counts ranked matches with `rated: {$ne: false}`, and the PostHog/`arenaStats` counter skips them. The leaderboard reads `players`, so it never sees them.
  - `match:over` for Ranked now always carries `rated`, with `eloDelta: 0` when unrated. `room:state` carries `rated` and `isPrivate`.
  - Audit #13: `isPrivate`/`hostId` moved off the per-instance WeakMap in `moderation.ts` onto the Room/snapshot. A host can now kick from an instance that only knows the room from Mongo. Vote tallies and the report/block "flagged" set are still per instance.
- **Report-then-leave.** `safety:leave` mid-match in a rated Ranked room ejects with `forfeit: true`, through the same `forfeitFor` path as any other leave (K=16; thrown away under `ForfeitSkipMs`).
  - The forfeit window is `matchInProgress`: countdown and turnA/swap/turnB/live.
  - The results screen before settlement (`awaitingSettlement`) is never a forfeit. That way a player who already sang, maybe winning, can't lose on a network blip.
    - When a seat leaves then, `forfeitFor` keeps the seated roster (`Room.settleSeats`, this instance only), so the match still settles on the scores with both seats. The leaver's card counts, or the empty-score fallback if it never arrived. ELO is applied once.
    - `settleIfScoresIn` settles at once if the remaining seat has posted. Otherwise the normal score wait does.
  - This closes the dodge for every kind of leave. Before, a leave there settled with one seat and persisted no ELO, so a losing player could escape by leaving or disconnecting.
  - `pruneRoom` drops dead seats before calling `forfeitFor`, so it now passes the roster from before the drop. Before, an idle-timeout forfeit settled with one seat and persisted no ELO either.
  - `safety:leave` on the score wait answers "You left. Your match is still scored as sung." The opponent is told "Your opponent left. The match is still scored as sung."
  - The report is still recorded. Lobby leaves stay free ("You left. No rating change."). Duet and friendly rooms keep the old behaviour: no rating, back to the lobby.
  - The ack carries `forfeit`. Copy: "You left. This counts as a forfeit." The opponent is told "Your opponent left the match. You win by forfeit."
- **Client copy.**
  - Stage header chip in friendly rooms: "Friendly match · doesn't affect ELO". Lobby code bar: "Friendly match: doesn't affect ELO. Starts in 5 seconds when you both sit down."
  - Results: "Unrated — friendly match" in place of the ELO line. The match video and share card get no ELO delta.
  - Private-room picker: "Same 20-second chorus. You then them. A friendly match: private rooms don't affect ELO." Home: "Make a private room · friendly matches, no ELO".
  - The safety sheet's leave button reads "Leave match · counts as a forfeit" while the match is sung, "Leave match · result still counts" on results before settlement, and otherwise "Leave match · no rating change". A line says the report is in either way. The blocked banner and the 1v1 fine print say the same. `/results-preview?friendly=1` previews the unrated card.
- Verified:
  - typecheck and build
  - 287/287 tests, 18 new in `friendlyRooms.test.ts`:
    - rated queue room, friendly settle, two-isolate claim race, host kick from a snapshot-only isolate, rematch, friendly forfeit, snapshot round trip and old snapshots, stats
    - report-then-leave in turnB, countdown, lobby and a friendly room
    - a results-phase disconnect by the winner (+16/−16 on the scores, one `match:over`)
    - a results-phase `safety:leave` by the loser (rated loss once the winner's card lands)
    - a results-phase leave with no card (empty-score fallback)
  - the peer e2e socket suite: 23/24, the one failure being the known entry-6 403
  - the full ranked match script unchanged (queue, +16/−16)
  - a new variants script:
    - a private match settles unrated, and its rematch stays unrated
    - a queue match where seat A reports and leaves at turnA+6s settles once as a rated forfeit (−8/+8)
    - a queue match where losing seat B drops on results before posting settles at once on the scores (+16 for A, not a forfeit), with one `match:over` after the 8s wait

### 8. Gemini quota limits and cross-instance room codes (`harden/gemini-and-codes`)
Audit findings #9 (Gemini quota / PostHog burn) and #10 (`room:create` code collision across instances).
- **Gemini verdicts (#9).** `/api/training/score` made one Gemini call per post with no limit, so one account looping training posts could use up the shared free quota.
  - Turn scores were already capped: `enrichScore` runs only after `recordScore` accepts the card, which is one per seat per match (entry 5).
  - Now every verdict call is charged to the verified user (`attachVerdict`, `server/src/abuseLimits.ts`). The limit is one call per 15s and 30 per rolling hour per user, and at most 4 calls in flight per instance. Past the in-flight cap the call is skipped, not queued. The existing 2.5s timeout still applies.
  - Over a limit, the post still returns 200 with the DSP card and the no-Gemini verdict: empty, source `dsp`, and the client shows its coach line. A silent take, a missing key, or a skip at the in-flight cap doesn't use up the user's budget.
  - The training analytics (the PostHog "training completed" event plus the stats counter) are capped the same way per user, at one per 15s and 30 per hour.
  - Per instance, like the other limiters. Maps are bounded at 10k users (least recently used dropped first).
- **Room codes (#10).** `room:create` checked its random code against this instance's rooms only. Another instance could already hold a live room with that code, and the new room's snapshot (`saveRoomSnap`, an upsert by code) would then overwrite it. The queue's `generateSharedCode` was check-then-insert, so it had a smaller version of the same race.
  - New `reserveSharedCode` in `liveState.ts` upserts the draft room's whole snapshot with `$setOnInsert` and counts the code as reserved only when `upsertedCount === 1`. A code that matches any existing `liveRooms` doc is taken: a live room elsewhere, or a leftover snapshot of an ended room (this closes the "leftover snapshot merges into the new room" open item). E11000 from the unique `{code}` index is treated the same way.
  - `room:create` uses `createSharedRoom`. Host, private and unrated are set on the draft, so the first snapshot already carries them. Queue matches reserve their code the same way.
  - Typing a fresh private lounge code in `chaos:join` claims that exact code (`reserveExactCode`). If another instance claimed it first, the caller joins that room instead.
  - Without Mongo (local, dev, tests), when Mongo errors, or after 40 taken codes, it falls back to the old local check. Join semantics are unchanged: unknown private codes still get `ROOM_UNAVAILABLE`, and the snapshot and LiveKit answers stay as they were (404 / 403 `NOT_SEATED`).
- **Lyrics on Vercel (not changed).** The services schema allows `services.*.functions.*.includeFiles`. I couldn't confirm how a glob that leaves the service root (`root: "server"`, so `../apps/web/public/songs/**/lyrics.lrc`) resolves, so `vercel.json` is unchanged and the open item stays.
- Verified:
  - typecheck and build
  - 305/305 tests (18 new):
    - `geminiBudget.test.ts`: budget and cap units, a training loop making one Gemini call, per-user budgets, the analytics cap, silent takes and a missing key not charged, 4 calls in flight with a 5th skipped at once, and hung calls timing out
    - `roomCodes.test.ts` on FakeDb: a code live on another instance is never handed out, two instances racing for one code, 200 concurrent creates all distinct, a leftover snapshot skipped, E11000 and Mongo-down fallbacks, `reserveExactCode`, unknown code still no room
  - the peer e2e suite: 23/24, the one failure being the known entry-6 403
  - `fullmatch.mjs` and `fullmatch-variants.mjs`: all passed

- Real-database check (local MongoDB 7 replica set, two server instances sharing it):
  - 800 concurrent `room:create`s split across both instances: **0 duplicate codes** on this branch, versus **19 duplicates** on main.
  - The peer e2e and both full-match scripts pass on real Mongo, which also exercises PR #19's settlement claim and per-seat score claims.

### 9. Client: take restarts, forfeit label, matchOver merge, LiveKit rejoin, pitch:live rate (`fix/client-stage-rejoin`)
Second-pass review findings #10, #13, #14, #15 and the pitch:live gate. Web client only.
- **Take restart mid-POST (#10).** The take key included `playAtUnixMs`, which differs per server instance for turn B. A socket `room:state` and a poll from another instance could restart the take while B's score was in flight, posting a silent card that raced the real one. The key is now matchId + seat + status (`stage/takeKey.ts`), and every take started this mount is remembered, so one that is singing, in flight or posted never restarts.
- **Forfeit label (#13).** The Stage said "counts as a forfeit" during the countdown and the first 5s of turn A, where the server's `forfeitWouldRate` throws the match away unrated. `stage/leaveEffect.ts` mirrors the server: a rated Ranked match is a forfeit only once `ForfeitSkipMs` have passed since its first clip began (`matchId`, the scheduled start, read against server time; it warns up to 250ms early, never late). Results before settlement still say "result still counts"; lobby, Duet and friendly rooms say "no rating change". The Stage banner and both safety-sheet labels use the one helper, and the label re-renders when the window opens.
- **matchOver merge (#14).** The 750ms poll replaced the socket's `match:over` and dropped `rated`/`forfeit` (the GET snapshot omits them). `rooms/matchOverMerge.ts` keeps them for the same match (tagged client-side with the room's `matchId`); a different match replaces everything.
- **LiveKit rejoin (#15).** A failed token fetch during a rejoin (403 `NOT_SEATED` before the Stage re-seats, a network blip) left media dead for the mount, since no further Disconnected event fires. The connect failure now schedules the next attempt on the same backoff budget (`retryFailedConnectMs`, `media/rejoin.ts`). On a bfcache restore (`pageshow` with `persisted`), RoomProvider drops the stale room so the Stage's join retry re-seats us, and `useLiveKit` reconnects with a fresh budget. No rejoin after a duplicate-identity kick, and unmount removes the listeners.
- **pitch:live rate.** The send gate was 40ms, about 24/s on 120/144Hz displays, over the server's 20/s cap. It is now 50ms (time-based).
- Verified: typecheck, build, 322/322 tests (17 new: `takeKey`, `leaveEffect`, `matchOverMerge`, rejoin policy), and `/`, `/signin`, `/play` render in headless Chromium with no app console errors (only the API proxy failing without a server, and Google sign-in having no account).
### 10. Room-create limit, reservation release, and sign-in lapses that cost seats (`fix/auth-lapse-create-limit`)
Second-pass review items 5, 6 and 7.
- **`room:create` limit (5).** Each create reserves its 4-digit code in `liveRooms` until the 2h TTL, and `disposeIfEmpty` never deleted it. One socket looping `room:create` could fill the code space. Then every create would cost 40 Mongo upserts and fall back to the local code, which brings back the cross-instance overwrite from entry 8.
  - Creates are now limited per verified account (per socket in the dev opt-out): 6 per sliding 5 minutes, all at once if you like (`WindowLimiter`, `server/src/abuseLimits.ts`).
  - Over the limit: `CREATE_RATE_LIMITED`, "You've made a lot of rooms. Wait N minutes and try again, or join a friend's code." Play.tsx already shows the server's message.
  - The refusal comes before leaving, so the caller keeps the room they are in. Joins are not affected. "Create, leave, create again" stays well under the limit.
- **Releasing reservations (5).** `room:create` now watches the private room it made (`watchReservation`, `liveState.ts`, additive). Every 30s, for each watched room this instance no longer holds, it runs one conditional `deleteOne` on its doc. The doc is deleted only if all of these hold:
  - it is still private, by the same host
  - `status: "lobby"`, `players: []`
  - no `settledMatchId` and no `matchScores` (it never played a match)
  - nobody has saved it for 2 minutes (`updatedAt`)
  - So a room another instance seated someone in, or saved recently, is never deleted. The host can still reload and rejoin for 2 minutes. If the room is in use elsewhere it stays watched; a room that played a match is left to the TTL.
  - Best effort. An instance that stops (Vercel) leaves the doc to the 2h TTL as before. Queue rooms and typed Chaos codes are not watched.
- **Supabase 429/408 (6).** Before, any 4xx was negatively cached for 60s, including 429. GoTrue rate limits per IP, and Vercel egress is shared, so one burst locked valid tokens out for a minute: sockets got `AUTH_REQUIRED` and score posts 401.
  - Now only 400/401/403 are cached. 408 and 429 are treated like 5xx: not cached, retried once after 250–350ms.
  - Other 4xx (e.g. 404 for a deleted user) are refused, not cached. A 200 without a user id counts as "could not check".
- **Sign-in lapses (7).** The hello path is now `helloAuth` (`server/src/auth.ts`). It tells "Supabase refused this token" apart from "token unusable locally" and "could not check".
  - (a) **Presence is not authorisation.** A hello from a socket with a session, whose sign-in lapsed or could not be re-checked, still refreshes its seat (`lastSeenMs`) and broadcasts, then answers `AUTH_REQUIRED`. The opponent's instance no longer prunes the seat after 45s and forfeits it. Play events (`room:ready`, rematch, create, join, queue) still refuse until a token verifies. Only a token Supabase refused gets no heartbeat.
  - (b) **Only a definite rejection signs a socket out.** That means a 4xx from Supabase (400/401/403 cached) for the held token, or for any token once the held one is past `exp` + 30s. A network error, timeout, 5xx, 408, 429, or a spent per-socket verify budget is "could not check". If the client sends a fresh-looking token we can't verify, the previous sign-in stays valid. Each failed check extends that by at most 60s, and never past `exp` + 10 min. The expired token itself, sent again, renews nothing.
  - (c) **Switch before expiry.** When a hello carries a different token and the held one expires within 2 minutes (or already has), the new token is verified then. So `room:ready` and rematch no longer hit `AUTH_REQUIRED` in the 0–12s before the next heartbeat. The held token is never re-checked early, so a steady heartbeat costs no Supabase calls.
  - Unchanged: a different token Supabase refuses while the held one is still valid changes nothing. The held one runs out on its own `exp`, as before.
- Verified:
  - typecheck and build
  - 331/331 tests (26 new):
    - `auth.test.ts`: 429/408 retried and never cached, 429-then-200 in one call, only 400/401/403 cached, outage grace kept and bounded, budget refusal is not a rejection, definite rejection signs out, the expired held token lapses with no call, a junk or expired token is "lapsed" not "rejected", a refusal ends the outage grace, a different bad token changes nothing, proactive switch only inside 2 min, and the hello answers synchronously unless Supabase is asked (so the heartbeat still seats its session before a following event)
    - `roomCodes.test.ts` on FakeDb: release after the grace and the code reusable, never while held here, not when seated or saved elsewhere, not after a match, mid-match or for another host, no-ops without Mongo, public rooms not watched
    - `abuseLimits.test.ts`:
      - limiter units
      - live dev server: 6 creates with leaves in between pass, the 7th is refused, the caller stays seated, and others can still create and join
      - live verify server with a flaky stub Supabase: a 429 burst then 200 lets the same token play at once; the successor token is verified ahead of expiry with no re-check of the held one; a lapsed seated socket gets `AUTH_REQUIRED` plus a seat-refresh `room:state` and `room:ready` is refused until a fresh token heals it; Supabase 503 while lapsed keeps the sign-in
  - the peer e2e suite: 23/24, the one failure being the known entry-6 403
  - `fullmatch.mjs` and `fullmatch-variants.mjs`: all passed
  - a standalone verify-mode probe: a stub Supabase answers 429 six times then 200, and the same token signs the socket in about 0.6s after the burst, authenticates over HTTP, and creates a room

### 11. Settlement correctness: leavers' cards, cross-instance seats, single match:over (`fix/settlement-correctness`)
Second-pass review of entries 5 and 7. Every fix is in the settle path (`clock.ts`, `rooms.ts`, `liveState.ts`, `scoreRoute.ts`, the leave/sweep/GET paths in `index.ts`), plus a three-line `seatAId` change on the client.
- **A leaver's in-flight card counts (1).** A seat that left on the results screen before settlement was rated as a silent 0 even when its clip-end POST was already in flight. The leave was handled first, then the score route refused the card (404 `PLAYER_NOT_IN_ROOM`), or the match had already settled on the remaining seat's card.
  - The score route now also takes a card from a seat of the current match that is no longer seated, while the match awaits settlement (`heldSeatId`). The seat index comes from the match roster.
  - A results-phase leave whose card is not in no longer settles at once. It settles after `LEAVER_SCORE_GRACE_MS` (3s, never past the 8s score wait), or as soon as every seat's card is in. The remaining seat posting no longer settles over a leaver whose card is missing.
- **Match roster in the snapshot (2).** `startMatch` stores `matchSeats` (public id, clientId, name, rating at start) in the room and its snapshot, so any instance settles with both seats. `settleSeats` was per instance, and the other instance's snapshot merge dropped the departed seat within ~8s. Its score-wait settle then rated one seat: `rated:true` with a non-zero `eloDelta`, and nothing persisted.
  - `applySnap` keeps the current match's seats while it awaits settlement.
  - Safety net: `match:over` says `rated:true` (and a non-zero delta) only when the rating was actually persisted. A one-seat settle, or a persist error, reports `rated:false` / 0.
- **No accepted card left out (3).** After winning the settlement claim, `finishMatch` reads the snapshot again and takes this match's `matchScores`. No claim can land after `settledMatchId` is set, so that read has every accepted card. A local card whose claim is still in flight is counted only if that read has it. Otherwise its POST gets 409 `MATCH_SETTLED`, so the result and the POST's answer agree.
- **One match:over per instance (4).** There is a synchronous per-room `settlingMatchId` guard at the top of `finishMatch`, and one score wait per match (`scoreWait`, `awaitScores` is idempotent). The swap and turnB timers check the status before acting. Emits go through `announce`, once per match per instance; a local fallback can be followed by the real result, never the reverse.
  - An instance that learns the result from the snapshot (another instance settled it) now tells its own sockets once, from the clock sweep. Before, those sockets saw the result only through the GET poll.
  - The score wait has a wall-clock backstop in `advanceDue`, for an instance that reached results through a snapshot or lost its timer.
- **"Settled" means the result is known (8).** `claimSettlement` marks the claim before the winner has persisted, and other instances took that as settled. `GET /api/rooms` then showed a winner from partial scores and `eloDelta` 0, which the client kept. Now `applySnap` treats the match as settled only when `settledResult.matchId` is the current match, and takes winner, delta, cards, `rated`, `forfeit` and `seatAId` from it (`room.result`). `GET /api/rooms` reports `settled`/`matchOver` from that result only.
- **ELO sign after a reconnect (9).** `match:over`, `settledResult` and the GET `matchOver` carry `seatAId`, the seat `eloDelta` is relative to. The client computes `myDelta` from it, falling back to `room.players[0]`. A player who re-seats during the same match goes back to their original index. New ratings are set by seat id on every object that holds the seat.
- **Mongo errors don't wedge settlement (11).** The snapshot reads in `finishMatch` are caught. Convergence never throws: if the winner's result can't be read (timeout or error), it emits a local fallback (cards held here, `eloDelta` 0, no `rated`) and the real result replaces it when it arrives.
- **Both seats leave during the score wait (12).** `disposeIfEmpty` keeps a room that awaits settlement. The leaver grace (or score wait) settles it, and the sweep disposes it after. `0000` is reset to the lobby after it settles empty, not before.
- Verified (rebased on c66e341):
  - typecheck and build
  - 365/365 tests, 17 new:
    - `friendlyRooms.test.ts`: in-flight leaver card counted; the remaining seat's post doesn't settle over it; cross-instance leave settles with both seats with ELO persisted once; one-seat safety net; claim-before-result is not "settled"; `seatAId`/ELO after a reconnect reorder; both seats leave
    - `settlementClaim.test.ts`: card claimed between read and claim included; in-flight local claim excluded and refused; overlapping `finishMatch` emits once; score wait armed once; snapshot-learned result announced once; `loadSnap` throwing; convergence error fallback
    - `scoreIntegrity.test.ts`: held-seat POST accepted (200) while a stranger and a mid-match leaver get 404; roster seat order
    - `matchOverMerge.test.ts`: `seatAId` survives a poll
  - One existing test changed: a no-card results leave now settles after the grace, not at once.
  - Real MongoDB replica set, two instances (8110/8111):
    - peer e2e 22/23, the one failure the known entry-6 403
    - `fullmatch.mjs` and `fullmatch-variants.mjs`: all passed
  - A new two-instance script (seat A on one instance, seat B on the other, demo room `0000`, both polling like the client; fresh servers per scenario). Before is cf7ad2d, after is this branch:
    - **Bug 1** (B's 90 posted as results start, leave handled first). Before: the card got 409 `MATCH_SETTLED`, A won, A 1016 / B 984. After: 200, B wins, `eloDelta` −16 with `seatAId` = A, players A 984 / B 1016, 1 matches doc holding the 90.
    - **Bug 2** (B quiet through turnB, leaves on its instance; A's card lands on A's instance after). Before: `rated:true`, `eloDelta` 16, **0 matches docs, ELO 1000/1000**. After: 1 matches doc, A 1016 / B 984, reported delta 16 equal to the persisted one.
    - **Bug 4** (both instances' clocks hammered across the swap edge). Before: seat B's socket got **2** `match:over`. After: 1 per socket, 1 matches doc, ELO once.

## Open items (need a decision or larger change)

- `0000` played across two instances can stay on `results` with ghost seats for up to the 45s idle drop after both players leave. Each instance re-adds the other's departed player from the snapshot, and the room is reset only on an explicit last leave. Seen while testing entry 11; not changed there.
- A rematch can still be accepted on the results screen before settlement. It resets the match, and the pending settlement then gives up (no ELO). Consider allowing rematch only once settled.
- A settlement claimed by an instance that then dies before publishing leaves the match claimed with no result. Other instances show the local fallback (no ELO) and refuse further cards. ELO was either persisted by the dying instance (matches doc) or not at all; the room shows no delta either way.

- Rate limits are per instance (room joins, room creates, hello verification, reports, blocks, votes, Gemini verdicts, training analytics). A shared limiter (Mongo TTL collection or Upstash) would make them global on Vercel.
- Releasing abandoned `room:create` reservations (entry 9) runs on a 30s timer of the instance that made the room. On Vercel, an instance that stops first leaves the doc to the 2h TTL. A sturdier option is a second TTL index on an `expireAt` field: set it about 10 minutes out while a private lobby is empty, and clear it when someone sits down. That needs a `db.ts` index and a write in the seat/leave path.
- The outage grace (entry 9) lets a socket whose token can't be checked keep play rights for up to 10 minutes past `exp`, as long as it keeps sending fresh-looking tokens. A forged token only extends this while Supabase is actually unreachable or rate limiting us. Shorten `SocketAuthOutageGraceMs` if that is too generous.
- Private room codes are 4 digits. The join limit makes guessing slow, but a longer code (or a 6-digit option for private rooms) would make it impractical.
- A fresh handshake per connection can still cost one Supabase call per unique, well-formed but forged JWT. A per-IP connection limit (e.g. Vercel WAF rate limit on `/socket.io`) would cap it.
- The `0000` demo room is still rated, and anyone who knows the code can join it. Consider making it friendly too.
- `safety:leave` needs a report or block recorded on the same instance (the "flagged" set is per instance). On Vercel the leave can be refused after a report on another instance. The ordinary leave still works, and it forfeits the same way.
- On Vercel, the 20s delayed LiveKit drop after a socket disconnect only fires if the instance stays alive that long. An explicit `room:leave` (pagehide, navigation) drops the media session straight away.
- Full Content-Security-Policy: draft in docs/csp-draft.md. Ship as Report-Only first.
- Song lyrics may not be bundled with the Vercel API function, so Gemini falls back to cleaned client lyrics. `serverLyrics()` reads them with a computed path, which file tracing likely misses. The schema allows `services.api.functions["src/index.ts"].includeFiles`, but it's unconfirmed whether a glob leaving the service root (`../apps/web/public/songs/**/lyrics.lrc`) resolves. Try it on a preview deploy and check a training verdict quotes the song. The alternative is copying the LRCs under `server/` at build time.
- react-router v6 → v7 upgrade to clear the remaining advisories. Our own `next=` handling goes through `safeNext`; check whether any `<Link>`/`navigate` takes user input.
