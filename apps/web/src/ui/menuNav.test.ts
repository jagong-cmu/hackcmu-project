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

// Grid: 7 items in 3 columns.
//   0 1 2
//   3 4 5
//   6
const grid = { count: 7, columns: 3 };

test("grid: Left/Right move within the list, Up/Down move by a row", () => {
  assert.equal(navigate({ ...grid, index: 4 }, "ArrowRight").index, 5);
  assert.equal(navigate({ ...grid, index: 4 }, "ArrowLeft").index, 3);
  assert.equal(navigate({ ...grid, index: 4 }, "ArrowDown").index, 4); // nothing below 4: stay
  assert.equal(navigate({ ...grid, index: 1 }, "ArrowDown").index, 4);
  assert.equal(navigate({ ...grid, index: 3 }, "ArrowDown").index, 6);
  assert.equal(navigate({ ...grid, index: 6 }, "ArrowUp").index, 3);
});

test("grid: edges stop instead of wrapping", () => {
  assert.equal(navigate({ ...grid, index: 1 }, "ArrowUp").index, 1);
  assert.equal(navigate({ ...grid, index: 0 }, "ArrowLeft").index, 0);
  assert.equal(navigate({ ...grid, index: 6 }, "ArrowRight").index, 6);
});

test("grid: disabled cells are skipped in the direction of travel", () => {
  assert.equal(navigate({ ...grid, index: 0, disabled: new Set([3]) }, "ArrowDown").index, 6);
  assert.equal(navigate({ ...grid, index: 3, disabled: new Set([4]) }, "ArrowRight").index, 5);
  assert.equal(navigate({ ...grid, index: 0, disabled: new Set([3, 6]) }, "ArrowDown").index, 0);
});

test("a vertical list ignores Left/Right", () => {
  assert.equal(navigate({ index: 2, count: 5 }, "ArrowRight").index, 2);
  assert.equal(navigate({ index: 2, count: 5 }, "ArrowLeft").index, 2);
});
