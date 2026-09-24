// The track ramp: later stages demand more corners. The generator's default
// path must not move — every ghost and leaderboard time is keyed to it.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { stageShape } = await import(new URL("run/stages.js", root));
const { buildTrack, cornerCount } = await import(new URL("track/generator.js", root));
const { buildGuides } = await import(new URL("track/guides.js", root));
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { mulberry32, hashStr } = await import(new URL("core/random.js", root));

const rngFor = seed => mulberry32(hashStr(seed));

test("stageShape: four corners at stage 1, nine by the knee, then holds", () => {
  assert.equal(stageShape(1).corners, 4);
  assert.equal(stageShape(8).corners, 9);
  assert.equal(stageShape(30).corners, 9);
  for (let n = 1; n < 30; n++) assert.ok(stageShape(n + 1).corners >= stageShape(n).corners, "stage " + n + " loosens");
});

test("stageShape never tightens corners: the road-width invariant holds", () => {
  for (let n = 1; n <= 30; n++) assert.equal(stageShape(n).minR, 185);
});

test("cornerCount agrees with the guide heuristic", () => {
  for (const seed of ["2026-09-22", "2026-09-22#run6", "2026-09-20#run1"]) {
    const t = buildTrack(rngFor(seed));
    assert.equal(cornerCount(t.S), buildGuides(t.S).length, seed);
  }
});

test("buildTrack honours a corner floor", () => {
  // 2026-09-22#run6 has 2 corners with the default shape.
  const t = buildTrack(rngFor("2026-09-22#run6"), { minR: 185, corners: 9 });
  assert.ok(cornerCount(t.S) >= 9, "got " + cornerCount(t.S) + " corners");
  assert.ok(t.minR > 185);
});

test("buildTrack with no shape is unchanged: the daily track keeps its id", () => {
  // Pinned before the shape argument existed. If this fails, every ghost and
  // leaderboard time is orphaned — the generator's default path must not move.
  loadTrackGeometry("2026-09-22");
  assert.equal(track.id, "1e6ktra");
});

test("loadTrackGeometry passes the shape through", () => {
  loadTrackGeometry("2026-09-22#run6", stageShape(9));
  assert.ok(cornerCount(track.samples) >= 9);
});

test("the fallback never returns a corner tighter than the road: two seeds that used to", () => {
  // Found by sweeping 720 stage seeds: no candidate was accepted, and the
  // fallback kept a first candidate with a tightest radius under 100px.
  for (const seed of ["2026-11-12#run12", "2026-11-14#run12"]) {
    const t = buildTrack(rngFor(seed), stageShape(12));
    assert.ok(t.minR > 185, seed + " minR " + t.minR.toFixed(0));
  }
});
