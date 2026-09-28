// A live attempt is one lap from a standing start, replayed on the round's
// seed with laps: 1. The daily's three-lap default must not change.
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
const { PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { bootstrap } = await import(new URL("sim/simulate.js", root));
const { createInput } = await import(new URL("sim/schedule.js", root));
const { seedFor } = await import(new URL("live/clock.js", root));
const { replay } = await import(new URL("../worker/src/replay.js", import.meta.url));

const key = (type, k) => (listeners[type] || []).forEach(fn => fn({ key: k }));

/** Drive one lap of `seed` with the game's own step, as the client records it. */
export function recordLap(seed) {
  loadTrackGeometry(seed);
  const input = createInput(bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1 }).schedule);
  resetRace(track.samples[0]);
  let held = 0;
  while (car.lap <= 1 && race.steps < 120 * 60) {
    const want = input(car.lap - 1 + car.prog);
    if (want !== held) {
      key("keyup", "ArrowLeft"); key("keyup", "ArrowRight");
      if (want === -1) key("keydown", "ArrowLeft");
      if (want === 1) key("keydown", "ArrowRight");
      held = want;
    }
    step(PHYSICS_DT);
  }
  assert.ok(car.lap > 1, "the lap must finish");
  return { seed, inputs: race.inputs.slice(), time: race.time };
}

const lap = recordLap(seedFor(3));

test("a genuine one-lap attempt replays to its own time", () => {
  const r = replay(lap.seed, lap.inputs, { claimedTime: lap.time, laps: 1 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.time, lap.time);
});

test("a claimed time off by more than the tolerance is refused", () => {
  const r = replay(lap.seed, lap.inputs, { claimedTime: lap.time - 0.5, laps: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "time-mismatch");
});

test("an attempt on another round's seed doesn't verify", () => {
  const r = replay(seedFor(4), lap.inputs, { claimedTime: lap.time, laps: 1 });
  assert.equal(r.ok, false);
});

test("without laps the replay is still the daily's three laps", () => {
  const r = replay(lap.seed, lap.inputs, { claimedTime: lap.time });
  assert.equal(r.ok, false, "a one-lap run must not pass as a full race");
});
