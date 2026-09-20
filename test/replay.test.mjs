import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.location = { search: "" };
const listeners = {};
globalThis.addEventListener = (n, fn) => (listeners[n] ||= []).push(fn);
const fakeEl = () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
globalThis.document = { getElementById: fakeEl, addEventListener() {} };

const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { car, race, resetRace } = await import(new URL("game/state.js", root));
const { step } = await import(new URL("game/physics.js", root));
const { PHYSICS_DT, LAPS } = await import(new URL("config/tuning.js", root));
const { bootstrap } = await import(new URL("sim/simulate.js", root));
const { createInput } = await import(new URL("sim/schedule.js", root));
const { replay, trackFor, TIME_TOLERANCE } = await import(new URL("../worker/src/replay.js", import.meta.url));

const key = (type, k) => (listeners[type] || []).forEach(fn => fn({ key: k }));

// Drive a full three-lap run with the game's wrapper, steered by the
// optimiser's controller so it actually finishes, and keep what the client
// would submit.
function recordRun(seed) {
  loadTrackGeometry(seed);
  const sched = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120 }).schedule;
  const input = createInput(sched);
  resetRace(track.samples[0]);
  let held = 0;
  while (car.lap <= LAPS && race.steps < 120 * 75) {
    const want = input(car.lap - 1 + car.prog);
    if (want !== held) {
      key("keyup", "ArrowLeft"); key("keyup", "ArrowRight");
      if (want === -1) key("keydown", "ArrowLeft");
      if (want === 1) key("keydown", "ArrowRight");
      held = want;
    }
    step(PHYSICS_DT);
  }
  assert.ok(car.lap > LAPS, "test run must finish");
  return { seed, trackId: track.id, inputs: race.inputs.slice(), ghost: race.rec.slice(), time: race.time };
}

test("trackFor rebuilds a track and caches it by seed", () => {
  const a = trackFor("replay-seed");
  const b = trackFor("replay-seed");
  assert.equal(a, b);
  assert.match(a.id, /^[0-9a-z]+$/);
  assert.ok(a.samples.length > 500);
});

test("a genuine run replays to the identical time", () => {
  const run = recordRun("replay-test-1");
  const r = replay(run.seed, run.inputs, { ghost: run.ghost, claimedTime: run.time });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.time, run.time);
  assert.ok(r.maxDeviation < 0.2, "exact replay stays within ghost rounding");
});

test("a claimed time that doesn't match the replay is rejected", () => {
  const run = recordRun("replay-test-1");
  const r = replay(run.seed, run.inputs, { ghost: run.ghost, claimedTime: run.time - 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "time-mismatch");
});

test("tampered inputs are rejected by the ghost path check", () => {
  const run = recordRun("replay-test-1");
  const tampered = run.inputs.slice();
  tampered[2] += 30;                                  // move the first turn late
  const r = replay(run.seed, tampered, { ghost: run.ghost, claimedTime: run.time });
  assert.equal(r.ok, false);
  assert.ok(r.reason === "path-mismatch" || r.reason === "time-mismatch" || r.reason === "unfinished");
});

test("a run that never finishes is rejected", () => {
  const r = replay("replay-test-1", [], { ghost: [], claimedTime: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unfinished");
});

test("TIME_TOLERANCE lets a last-bit difference through", () => {
  const run = recordRun("replay-test-1");
  const r = replay(run.seed, run.inputs, { ghost: run.ghost, claimedTime: run.time + TIME_TOLERANCE * 0.5 });
  assert.equal(r.ok, true);
});
