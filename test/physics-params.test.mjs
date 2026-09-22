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
const { T, HALF_W, PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { on } = await import(new URL("core/events.js", root));

const speedOf = c => Math.hypot(c.vx, c.vy);

test("T carries the chain constants at their previous hardcoded values", () => {
  assert.equal(T.multRise, 0.30);
  assert.equal(T.multFall, 0.10);
  assert.equal(T.multCap, 4);
  assert.equal(T.multOffKeep, 0);
});

test("integrate with the default table equals integrate with a copy of T", () => {
  loadTrackGeometry("params-test");
  const a = createCar(), b = createCar();
  placeCar(a, track.samples[0]); placeCar(b, track.samples[0]);
  for (let i = 0; i < 400; i++) { integrate(a, i > 200 ? 1 : 0, PHYSICS_DT); integrate(b, i > 200 ? 1 : 0, PHYSICS_DT, 45, { ...T }); }
  assert.equal(a.x, b.x); assert.equal(a.y, b.y); assert.equal(a.a, b.a);
});

test("a modified table changes the car", () => {
  loadTrackGeometry("params-test");
  const slow = createCar(), fast = createCar();
  placeCar(slow, track.samples[0]); placeCar(fast, track.samples[0]);
  const P = { ...T, maxSpeed: T.maxSpeed * 0.5 };
  for (let i = 0; i < 600; i++) { integrate(slow, 0, PHYSICS_DT, 45, P); integrate(fast, 0, PHYSICS_DT); }
  assert.ok(speedOf(slow) < speedOf(fast) * 0.7, "half top speed must show after five seconds");
});

test("track.halfW is the road half-width the physics uses", () => {
  loadTrackGeometry("params-test");
  assert.equal(track.halfW, HALF_W);
  const s = track.samples[0];
  const c = createCar(); placeCar(c, s);
  c.x = s.x + s.nx * 100; c.y = s.y + s.ny * 100;   // 100px off the centreline
  integrate(c, 0, PHYSICS_DT);
  assert.equal(c.off, false);
  track.halfW = 50;
  integrate(c, 0, PHYSICS_DT);
  assert.equal(c.off, true);
  track.halfW = HALF_W;
});

test("loadTrackGeometry resets track.halfW", () => {
  track.halfW = 10;
  loadTrackGeometry("params-test-2");
  assert.equal(track.halfW, HALF_W);
});

test("multOffKeep scales what a wall leaves of the chain", () => {
  loadTrackGeometry("params-test");
  const s = track.samples[0];
  const c = createCar(); placeCar(c, s);
  c.mult = 3;
  c.x = s.x + s.nx * (HALF_W + 40); c.y = s.y + s.ny * (HALF_W + 40);
  integrate(c, 0, PHYSICS_DT, 45, { ...T, multOffKeep: 1 });
  assert.equal(c.off, true);
  assert.equal(c.mult, 3);
  const h = createCar(); placeCar(h, s);
  h.mult = 3; h.x = c.x; h.y = c.y;
  integrate(h, 0, PHYSICS_DT, 45, { ...T, multOffKeep: 0.5 });
  assert.equal(h.mult, 2, "half of the chain above ×1 survives");
  const d = createCar(); placeCar(d, s);
  d.mult = 3; d.x = c.x; d.y = c.y;
  integrate(d, 0, PHYSICS_DT);
  assert.equal(d.mult, 1);
});

test("step() uses race.params and returns the flags", () => {
  loadTrackGeometry("params-test");
  resetRace(track.samples[0]);
  assert.equal(race.params, T);
  race.params = { ...T, accel: 0, boostAccel: 0 };
  let flags = 0;
  for (let i = 0; i < 120; i++) flags = step(PHYSICS_DT);
  assert.equal(typeof flags, "number");
  assert.equal(speedOf(car), 0, "no thrust means no motion");
  resetRace(track.samples[0]);
  assert.notEqual(race.params, T, "resetRace must not touch race.params");
  race.params = T;
});

test("chain-break only fires when the chain was actually lost", () => {
  loadTrackGeometry("params-test");
  const s = track.samples[0];

  // Off-road tax: multOffKeep 1, so an excursion drains the timer instead
  // of resetting the chain. The cue must stay silent.
  resetRace(s);
  car.mult = 3;
  car.x = s.x + s.nx * (HALF_W + 40);
  car.y = s.y + s.ny * (HALF_W + 40);
  race.params = { ...T, multOffKeep: 1 };
  let fired = false;
  const off = on("chain-break", () => { fired = true; });
  step(PHYSICS_DT);
  off();
  assert.equal(fired, false, "a mod that keeps the chain through an excursion must not cue a loss");
  assert.equal(car.mult, 3);

  // Default table: the same excursion really does reset the chain, so the cue must fire.
  resetRace(s);
  car.mult = 3;
  car.x = s.x + s.nx * (HALF_W + 40);
  car.y = s.y + s.ny * (HALF_W + 40);
  race.params = T;
  fired = false;
  const off2 = on("chain-break", () => { fired = true; });
  step(PHYSICS_DT);
  off2();
  assert.equal(fired, true, "the default table must still cue a real loss");
  assert.equal(race.lostMult, 3);
  assert.equal(race.keptMult, 1);

  race.params = T;
});
