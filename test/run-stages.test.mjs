import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { stageSeed, beats, parseBest, bestKeyDay, BEST_KEY_ALL } = await import(new URL("run/stages.js", root));
const { run } = await import(new URL("run/state.js", root));

test("stage seeds give distinct tracks, all distinct from the daily one", () => {
  const day = "2026-09-22";
  loadTrackGeometry(day);
  const ids = new Set([track.id]);
  for (let n = 1; n <= 10; n++) {
    loadTrackGeometry(stageSeed(day, n));
    assert.ok(!ids.has(track.id), "stage " + n + " collides");
    ids.add(track.id);
  }
  assert.equal(stageSeed(day, 4), "2026-09-22#run4");
});

test("beats: more stages, then more progress, and anything beats nothing", () => {
  assert.equal(beats({ stages: 3, prog: 0.1 }, null), true);
  assert.equal(beats(null, { stages: 0, prog: 0 }), false);
  assert.equal(beats({ stages: 3, prog: 0.1 }, { stages: 2, prog: 0.9 }), true);
  assert.equal(beats({ stages: 2, prog: 0.9 }, { stages: 3, prog: 0.1 }), false);
  assert.equal(beats({ stages: 3, prog: 0.5 }, { stages: 3, prog: 0.4 }), true);
  assert.equal(beats({ stages: 3, prog: 0.4 }, { stages: 3, prog: 0.4 }), false);
});

test("parseBest survives missing and corrupt storage", () => {
  assert.equal(parseBest(null), null);
  assert.equal(parseBest(""), null);
  assert.equal(parseBest("{not json"), null);
  assert.equal(parseBest('{"stages":"x"}'), null);
  assert.equal(parseBest('[1,2]'), null);
  assert.deepEqual(parseBest('{"stages":4,"prog":0.25,"picks":["loose"]}'), { stages: 4, prog: 0.25, picks: ["loose"] });
  assert.deepEqual(parseBest('{"stages":4}'), { stages: 4, prog: 0, picks: [] });
});

test("storage keys", () => {
  assert.equal(bestKeyDay("2026-09-22"), "neondrift:run:2026-09-22:best");
  assert.equal(BEST_KEY_ALL, "neondrift:run:best");
});

test("the run state starts inactive and empty", () => {
  assert.equal(run.active, false);
  assert.deepEqual(run.picks, []);
  assert.deepEqual(run.stages, []);
  assert.equal(run.bestDay, null);
});
