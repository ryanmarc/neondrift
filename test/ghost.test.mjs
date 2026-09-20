import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, val) => store.set(k, String(val)),
  removeItem: k => store.delete(k),
};
const g = await import(new URL("../js/game/ghost.js", import.meta.url));

// two recordings: "mine" sits at x=0, the rival at x=1000, both 3 frames at 30Hz
const mine = [0, 0, 0, 0.0, 0, 10, 0, 0.5, 0, 20, 0, 1.0];
const rival = [1000, 0, 0, 0.0, 1000, 10, 0, 0.5, 1000, 20, 0, 1.0];

test("with no rival, playback and progress lookups use your own recording", () => {
  g.loadGhost("t1");
  g.commitRun(12.5, mine, [0, 1]);
  assert.equal(g.ghostAt(0).x, 0);
  assert.equal(g.targetTime(), 12.5);
  assert.ok(Math.abs(g.ghostTimeAtProgress(0.5) - 1 / 30) < 1e-9);
});

test("a rival replaces the recording, the target time, and the progress lookup", () => {
  g.setRival({ id: "abc", name: "Rival", tag: "abcd", time: 9.75, data: rival });
  assert.equal(g.ghostAt(0).x, 1000);
  assert.equal(g.targetTime(), 9.75);
  assert.equal(g.ghost.bestTime, 12.5, "your own best is untouched");
  g.setRival(null);
  assert.equal(g.ghostAt(0).x, 0);
  assert.equal(g.targetTime(), 12.5);
});

test("a personal best while racing a rival still saves your own ghost", () => {
  g.setRival({ id: "abc", name: "Rival", tag: "abcd", time: 9.75, data: rival });
  const r = g.commitRun(11.0, mine, [0, 1]);
  assert.equal(r.isPB, true);
  assert.equal(g.ghost.bestTime, 11.0);
  assert.equal(store.get("neondrift:tt1:best"), "11");
  assert.equal(g.ghostAt(0).x, 1000, "still racing the rival");
});

test("loading a new track clears the rival", () => {
  g.loadGhost("t2");
  assert.equal(g.ghost.rival, null);
  assert.equal(g.ghostAt(0), null);
});
