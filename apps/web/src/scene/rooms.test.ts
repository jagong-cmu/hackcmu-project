/**
 * Which room a screen shows. One room per mode; room 0000 and private rooms
 * use the room of their mode; non-game pages use the default room, darkened.
 *
 * Run: npx tsx --test apps/web/src/scene/rooms.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultRoom, RoomIds, nextLikelyRoom, roomForMode, sceneFor } from "./rooms.ts";

test("one room per mode", () => {
  assert.equal(roomForMode("ranked"), "ranked");
  assert.equal(roomForMode("duet"), "duet");
  assert.equal(roomForMode("training"), "training");
  assert.equal(roomForMode("chaos"), "party");
});

test("an unknown or missing mode gets the default room", () => {
  assert.equal(roomForMode(undefined), DefaultRoom);
  assert.equal(roomForMode(null), DefaultRoom);
  assert.equal(roomForMode("nonsense"), DefaultRoom);
  assert.equal(DefaultRoom, "ranked");
});

test("game routes use their mode's room, undimmed", () => {
  assert.deepEqual(sceneFor("/play/ranked"), { room: "ranked", dim: false });
  assert.deepEqual(sceneFor("/play/duet"), { room: "duet", dim: false });
  assert.deepEqual(sceneFor("/play/chaos"), { room: "party", dim: false });
  assert.deepEqual(sceneFor("/training"), { room: "training", dim: false });
});

test("a live room (room 0000 or a private code) follows the room's own mode", () => {
  assert.deepEqual(sceneFor("/room/0000", { roomMode: "ranked" }), { room: "ranked", dim: false });
  assert.deepEqual(sceneFor("/room/4821", { roomMode: "duet" }), { room: "duet", dim: false });
  assert.deepEqual(sceneFor("/room/9999", { roomMode: "chaos" }), { room: "party", dim: false });
  // Before the room's state arrives, fall back to the default rather than flashing a wrong room.
  assert.deepEqual(sceneFor("/room/0000"), { room: "ranked", dim: false });
});

test("leaderboards show their mode's room", () => {
  assert.deepEqual(sceneFor("/leaderboard"), { room: "ranked", dim: false });
  assert.deepEqual(sceneFor("/leaderboard", { leaderboardTab: "duet" }), { room: "duet", dim: false });
});

test("the main menu shows the selected mode's room, default before any selection", () => {
  assert.deepEqual(sceneFor("/"), { room: "ranked", dim: false });
  assert.deepEqual(sceneFor("/", { menuRoom: "party" }), { room: "party", dim: false });
  assert.deepEqual(sceneFor("/play", { menuRoom: "training" }), { room: "training", dim: false });
});

test("non-game pages use the default room, darkened", () => {
  for (const path of ["/signin", "/settings", "/privacy", "/terms", "/nope", "/check", "/check/voice", "/stats"]) {
    assert.deepEqual(sceneFor(path), { room: "ranked", dim: true }, path);
  }
});

test("preload hint: the next room down the menu, wrapping", () => {
  assert.equal(nextLikelyRoom("ranked"), "duet");
  assert.equal(nextLikelyRoom("duet"), "training");
  assert.equal(nextLikelyRoom("training"), "party");
  assert.equal(nextLikelyRoom("party"), "ranked");
  assert.equal(RoomIds.length, 4);
});
