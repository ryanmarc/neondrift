import { test } from "node:test";
import assert from "node:assert/strict";

// Node stand-ins for the few DOM touches the game's wrapper modules make.
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
const { createCar, placeCar, integrate } = await import(new URL("game/dynamics.js", root));
const { PHYSICS_DT } = await import(new URL("config/tuning.js", root));

const key = (type, k) => (listeners[type] || []).forEach(fn => fn({ key: k }));

test("physics records the step at which the input changes", () => {
  loadTrackGeometry("record-test");
  resetRace(track.samples[0]);
  for (let i = 0; i < 100; i++) step(PHYSICS_DT);          // straight
  key("keydown", "ArrowLeft");
  for (let i = 0; i < 40; i++) step(PHYSICS_DT);           // hold left
  key("keyup", "ArrowLeft");
  for (let i = 0; i < 60; i++) step(PHYSICS_DT);           // release
  assert.equal(race.steps, 200);
  assert.deepEqual(race.inputs, [100, -1, 140, 0]);
});

test("replaying the recorded inputs reproduces the run exactly", () => {
  loadTrackGeometry("record-test");
  resetRace(track.samples[0]);
  const pattern = [[0, 0], [90, 1], [130, 0], [200, -1], [260, 0], [300, 1], [330, 0]];
  let p = 0;
  for (let i = 0; i < 500; i++) {
    if (p < pattern.length && pattern[p][0] === i) {
      const inp = pattern[p][1];
      key("keyup", "ArrowLeft"); key("keyup", "ArrowRight");
      if (inp === -1) key("keydown", "ArrowLeft");
      if (inp === 1) key("keydown", "ArrowRight");
      p++;
    }
    step(PHYSICS_DT);
  }
  // replay through the pure dynamics using only race.inputs
  const c = createCar(); placeCar(c, track.samples[0]);
  let ptr = 0, inp = 0;
  for (let i = 0; i < race.steps; i++) {
    while (ptr < race.inputs.length && race.inputs[ptr] === i) { inp = race.inputs[ptr + 1]; ptr += 2; }
    integrate(c, inp, PHYSICS_DT);
  }
  assert.equal(c.x, car.x);
  assert.equal(c.y, car.y);
  assert.equal(c.a, car.a);
  assert.equal(c.lap, car.lap);
});
