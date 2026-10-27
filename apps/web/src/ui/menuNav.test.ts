/**
 * Menu keyboard navigation: arrow keys wrap, Enter selects, Esc goes back,
 * disabled items are skipped.
 *
 * Run: npx tsx --test apps/web/src/ui/menuNav.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { navigate } from "./menuNav.ts";

const base = { index: 0, count: 5 };

test("ArrowDown and ArrowUp move one step", () => {
  assert.deepEqual(navigate(base, "ArrowDown"), { index: 1, action: null });
  assert.deepEqual(navigate({ index: 3, count: 5 }, "ArrowUp"), { index: 2, action: null });
});

test("arrow keys wrap at both ends", () => {
  assert.equal(navigate({ index: 4, count: 5 }, "ArrowDown").index, 0);
  assert.equal(navigate({ index: 0, count: 5 }, "ArrowUp").index, 4);
});

test("Home and End jump to the first and last item", () => {
  assert.equal(navigate({ index: 2, count: 5 }, "Home").index, 0);
  assert.equal(navigate({ index: 2, count: 5 }, "End").index, 4);
});

test("Enter and Space select the current item; Escape goes back", () => {
  assert.deepEqual(navigate({ index: 2, count: 5 }, "Enter"), { index: 2, action: "select" });
  assert.deepEqual(navigate({ index: 2, count: 5 }, " "), { index: 2, action: "select" });
  assert.deepEqual(navigate({ index: 2, count: 5 }, "Escape"), { index: 2, action: "back" });
});

test("disabled items are skipped in both directions, including across the wrap", () => {
  const disabled = new Set([1, 4]);
  assert.equal(navigate({ index: 0, count: 5, disabled }, "ArrowDown").index, 2);
  assert.equal(navigate({ index: 3, count: 5, disabled }, "ArrowDown").index, 0);
  assert.equal(navigate({ index: 0, count: 5, disabled }, "ArrowUp").index, 3);
  assert.equal(navigate({ index: 2, count: 5, disabled }, "ArrowUp").index, 0);
});

test("Enter on a disabled item does nothing", () => {
  assert.equal(navigate({ index: 1, count: 5, disabled: new Set([1]) }, "Enter").action, null);
});

test("other keys and empty menus are inert", () => {
  assert.deepEqual(navigate(base, "a"), { index: 0, action: null });
  assert.deepEqual(navigate({ index: 0, count: 0 }, "ArrowDown"), { index: 0, action: null });
  assert.deepEqual(navigate({ index: 0, count: 1 }, "ArrowDown"), { index: 0, action: null });
});

test("an all-disabled menu stays put", () => {
  const disabled = new Set([0, 1, 2]);
  assert.equal(navigate({ index: 1, count: 3, disabled }, "ArrowDown").index, 1);
});
