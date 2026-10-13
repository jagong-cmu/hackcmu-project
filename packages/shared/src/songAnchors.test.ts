/**
 * Clip anchors must not drift from the lyrics: firstLyricSec is the first
 * timestamped line of lyrics.lrc, chorusSec sits exactly on a line, and each
 * public/songs/<id>/meta.json agrees with SONGS.
 *
 * Run: npx tsx --test packages/shared/src/songAnchors.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SONGS } from "./songs.ts";

const SONGS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/public/songs",
);

/** Timestamps of lines with words, in file order — same rule as the web parseLrc. */
function lrcTimes(src: string): number[] {
  const out: number[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!m) continue;
    const text = (m[4] ?? "").replace(/^(?:\[(?:A|B|AB|BOTH)\]|(?:A|B|AB|BOTH)\s*[:|-])\s*/i, "").trim();
    if (!text) continue;
    const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0;
    out.push(+(Number(m[1]) * 60 + Number(m[2]) + frac).toFixed(3));
  }
  return out.sort((a, b) => a - b);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

for (const song of SONGS) {
  test(`${song.id}: anchors match lyrics.lrc and meta.json`, () => {
    const lrcPath = path.join(SONGS_DIR, song.id, "lyrics.lrc");
    assert.ok(existsSync(lrcPath), `missing ${lrcPath}`);
    const times = lrcTimes(readFileSync(lrcPath, "utf8"));
    assert.ok(times.length > 0, "lyrics.lrc has no timed lines");

    assert.equal(typeof song.firstLyricSec, "number", "SONGS entry needs firstLyricSec");
    assert.equal(typeof song.chorusSec, "number", "SONGS entry needs chorusSec");
    assert.ok(
      near(song.firstLyricSec!, times[0]!),
      `firstLyricSec ${song.firstLyricSec} != first lyric line ${times[0]}`,
    );
    assert.ok(
      times.some((t) => near(t, song.chorusSec!)),
      `chorusSec ${song.chorusSec} is not a lyrics.lrc timestamp`,
    );
    assert.ok(song.chorusSec! > song.firstLyricSec!, "chorus comes after the first lyric");

    const metaPath = path.join(SONGS_DIR, song.id, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    assert.equal(meta.firstLyricSec, song.firstLyricSec, "meta.json firstLyricSec");
    assert.equal(meta.chorusSec, song.chorusSec, "meta.json chorusSec");
    assert.equal(meta.clipDurationSec, song.clipDurationSec, "meta.json clipDurationSec");
    assert.equal(meta.duetClipDurationSec, song.duetClipDurationSec, "meta.json duetClipDurationSec");
  });
}
