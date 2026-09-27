// ?weather overrides the seed's weather for testing, and a forced run is
// practice: its score must never overwrite the day's or the all-time best.
import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, val) => store.set(k, String(val)),
  removeItem: k => store.delete(k),
};

const root = new URL("../js/", import.meta.url);
const { commitScore, bestKeyDay, BEST_KEY_ALL } = await import(new URL("run/stages.js", root));

const DAY = "2026-10-02";
const freshRun = () => ({ day: DAY, bestDay: null, bestAll: null });

test("persist false (a ?weather override) saves neither the day's nor the all-time best", () => {
  store.clear();
  const run = freshRun();
  const { isBest, practice } = commitScore(run, { stages: 4, prog: 0.5, picks: ["loose"] }, false);
  assert.equal(isBest, false);
  assert.equal(practice, true);
  assert.equal(run.bestDay, null);
  assert.equal(run.bestAll, null);
  assert.equal(store.get(bestKeyDay(DAY)), undefined);
  assert.equal(store.get(BEST_KEY_ALL), undefined);
});

test("persist true (the default: no override) saves a new best, day and all-time", () => {
  store.clear();
  const run = freshRun();
  const score = { stages: 4, prog: 0.5, picks: [] };
  const { isBest, practice } = commitScore(run, score, true);
  assert.equal(isBest, true);
  assert.equal(practice, false);
  assert.deepEqual(run.bestDay, score);
  assert.deepEqual(run.bestAll, { ...score, day: DAY });
  assert.equal(JSON.parse(store.get(bestKeyDay(DAY))).stages, 4);
  assert.equal(JSON.parse(store.get(BEST_KEY_ALL)).stages, 4);
});

test("a practice score never overwrites a real best that already beats it", () => {
  store.clear();
  const run = freshRun();
  commitScore(run, { stages: 5, prog: 0.9, picks: [] }, true);
  const before = { ...run.bestDay };
  const { isBest } = commitScore(run, { stages: 2, prog: 0.1, picks: [] }, false);
  assert.equal(isBest, false);
  assert.deepEqual(run.bestDay, before);
});
