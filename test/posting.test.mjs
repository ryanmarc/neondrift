import { test } from "node:test";
import assert from "node:assert/strict";

// leaderboard.js pulls in the track and identity modules; give them what they touch.
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: "", hostname: "example.test" };
const { board, worthPosting } = await import(new URL("../js/net/leaderboard.js", import.meta.url));

test("with the board loaded, a run is posted when it beats the posted time", () => {
  board.status = "ready"; board.me = { rank: 3, time: 40.0 };
  assert.equal(worthPosting({ time: 39.5, isPB: false }), true, "slower than local ghost, faster than posted: post");
  assert.equal(worthPosting({ time: 40.5, isPB: true }), false, "local PB but slower than posted: don't post");
  assert.equal(worthPosting({ time: 40.0, isPB: true }), false, "equal to posted: don't post");
});

test("with no posted row, any run is posted", () => {
  board.status = "ready"; board.me = null;
  assert.equal(worthPosting({ time: 55.0, isPB: false }), true);
});

test("without a loaded board, the local personal-best rule applies", () => {
  board.status = "unavailable"; board.me = null;
  assert.equal(worthPosting({ time: 30.0, isPB: false }), false);
  assert.equal(worthPosting({ time: 30.0, isPB: true }), true);
  board.status = "loading";
  assert.equal(worthPosting({ time: 30.0, isPB: true }), true);
});
