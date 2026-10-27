/**
 * Room codes are exactly 4 digits. 0000 is the permanent demo room and is valid.
 *
 * Run: npx tsx --test apps/web/src/ui/roomCode.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRoomCode, normalizeRoomCode } from "./roomCode.ts";

test("exactly four digits is valid, 0000 included", () => {
  assert.equal(isRoomCode("0000"), true);
  assert.equal(isRoomCode("1234"), true);
  assert.equal(isRoomCode("0007"), true);
});

test("anything else is invalid", () => {
  for (const bad of ["", "1", "123", "12345", "12a4", "abcd", " 123", "123 ", "１２３４", "-123", "12.3"]) {
    assert.equal(isRoomCode(bad), false, JSON.stringify(bad));
  }
});

test("typing is normalised: digits only, at most four", () => {
  assert.equal(normalizeRoomCode("12ab34"), "1234");
  assert.equal(normalizeRoomCode("123456"), "1234");
  assert.equal(normalizeRoomCode("a-b"), "");
  assert.equal(normalizeRoomCode("00 00"), "0000");
});

test("a normalised code is valid only once it has four digits", () => {
  assert.equal(isRoomCode(normalizeRoomCode("12")), false);
  assert.equal(isRoomCode(normalizeRoomCode("0 0 0 0")), true);
});
