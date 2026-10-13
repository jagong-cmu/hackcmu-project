/**
 * PostHog URL scrubber: OAuth codes, tokens and error text never leave the page.
 *
 * Run: npx tsx --test apps/web/src/analytics/scrubUrl.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubProperties, scrubUrl } from "./scrubUrl.ts";

const O = "https://karaoke-arena.vercel.app";

test("strips the PKCE code and state from /signin", () => {
  assert.equal(scrubUrl(`${O}/signin?code=abc123&state=xyz`), `${O}/signin`);
});

test("strips error + error_description but keeps harmless params", () => {
  assert.equal(
    scrubUrl(`${O}/signin?next=%2Fplay&error=access_denied&error_description=User+said+no`),
    `${O}/signin?next=%2Fplay`,
  );
});

test("drops the fragment (implicit-flow tokens)", () => {
  assert.equal(scrubUrl(`${O}/signin#access_token=t&refresh_token=r&type=bearer`), `${O}/signin`);
  assert.equal(scrubUrl(`${O}/play?x=1#y`), `${O}/play?x=1`);
});

test("strips token params case-insensitively", () => {
  assert.equal(
    scrubUrl(`${O}/x?Access_Token=a&REFRESH_TOKEN=b&token=c&keep=1`),
    `${O}/x?keep=1`,
  );
});

test("leaves clean URLs untouched", () => {
  assert.equal(scrubUrl(`${O}/room/1234`), `${O}/room/1234`);
  assert.equal(scrubUrl(`${O}/play/ranked?go=1`), `${O}/play/ranked?go=1`);
  assert.equal(scrubUrl(""), "");
});

test("handles relative paths", () => {
  assert.equal(scrubUrl("/signin?code=abc&next=%2Fplay#frag"), "/signin?next=%2Fplay");
});

test("scrubProperties hits every URL-ish property and nothing else", () => {
  const out = scrubProperties({
    $current_url: `${O}/signin?code=abc`,
    $referrer: `https://accounts.google.com/o/oauth2?state=s&x=1`,
    $initial_current_url: `${O}/signin#access_token=t`,
    $session_entry_url: `${O}/signin?error_description=nope`,
    $pathname: "/signin",
    $host: "karaoke-arena.vercel.app",
    note: "code=keep-me?code=1",
    n: 3,
  });
  assert.deepEqual(out, {
    $current_url: `${O}/signin`,
    $referrer: "https://accounts.google.com/o/oauth2?x=1",
    $initial_current_url: `${O}/signin`,
    $session_entry_url: `${O}/signin`,
    $pathname: "/signin",
    $host: "karaoke-arena.vercel.app",
    note: "code=keep-me?code=1",
    n: 3,
  });
});

test("scrubProperties passes undefined through", () => {
  assert.equal(scrubProperties(undefined), undefined);
});
