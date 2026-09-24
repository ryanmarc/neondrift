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
const { createCar, placeCar, integrate, SLIDING, WENT_OFF, OFF_FREE } = await import(new URL("game/dynamics.js", root));
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

const STOCK_KEYS = { slideSpeed: 210, boostSteer: false, multSpeed: 0, offFree: 0 };

test("the run's four extra keys at their stock values change nothing", () => {
  loadTrackGeometry("params-test");
  const a = createCar(), b = createCar();
  placeCar(a, track.samples[0]); placeCar(b, track.samples[0]);
  for (let i = 0; i < 600; i++) {
    const inp = (i > 200 && i < 320) || i > 500 ? 1 : 0;
    integrate(a, inp, PHYSICS_DT); integrate(b, inp, PHYSICS_DT, 45, { ...T, ...STOCK_KEYS });
  }
  assert.equal(a.x, b.x); assert.equal(a.y, b.y); assert.equal(a.a, b.a); assert.equal(a.boost, b.boost);
});

// Drive down the first straight to be at speed but still on the road (a straight
// drive on this track leaves the road after about 200 steps), then hold.
function warm(P, steps = 120) {
  loadTrackGeometry("params-test");
  const c = createCar(); placeCar(c, track.samples[0]);
  for (let i = 0; i < steps; i++) integrate(c, 0, PHYSICS_DT, 45, P);
  return c;
}

test("slideSpeed gates SLIDING", () => {
  const P = { ...T, slideSpeed: 1e9 };
  const c = warm(P);
  let slid = 0;
  for (let i = 0; i < 240; i++) if (integrate(c, 1, PHYSICS_DT, 45, P) & SLIDING) slid++;
  assert.equal(slid, 0);
  const d = warm({ ...T }); let slid2 = 0;
  for (let i = 0; i < 240; i++) if (integrate(d, 1, PHYSICS_DT, 45, { ...T }) & SLIDING) slid2++;
  assert.ok(slid2 > 0, "the stock gate lets a fast slide count");
});

test("boostSteer keeps boost firing while steering", () => {
  const P = { ...T, boostSteer: true };
  const c = warm(P); c.boost = 0.5;
  integrate(c, 1, PHYSICS_DT, 45, P);
  assert.equal(c.boosting, true);
  const d = warm({ ...T }); d.boost = 0.5;
  integrate(d, 1, PHYSICS_DT, 45, { ...T });
  assert.equal(d.boosting, false);
});

test("multSpeed raises top speed with the chain", () => {
  const P = { ...T, multSpeed: 0.06 };
  const c = warm(P, 100); c.mult = 4;
  for (let i = 0; i < 60; i++) integrate(c, 0, PHYSICS_DT, 45, P);
  const d = warm(P, 100); d.mult = 1;
  for (let i = 0; i < 60; i++) integrate(d, 0, PHYSICS_DT, 45, P);
  assert.ok(!c.off && !d.off, "both still on the road");
  assert.ok(speedOf(c) > speedOf(d) * 1.10, speedOf(c) + " vs " + speedOf(d));
});

// Push the car off the road sideways to force WENT_OFF on the next step.
function shove(c) { const s = track.samples[c.idx]; c.x = s.x + s.nx * 400; c.y = s.y + s.ny * 400; }

test("offFree spares the chain for that many excursions per stage, then cuts it", () => {
  const P = { ...T, offFree: 1, multOffKeep: 0 };
  const c = warm(P); c.mult = 3;
  shove(c);
  const f1 = integrate(c, 0, PHYSICS_DT, 45, P);
  assert.ok(f1 & WENT_OFF); assert.ok(f1 & OFF_FREE); assert.equal(c.mult, 3);
  // back on the road, then off again
  const s = track.samples[c.idx]; c.x = s.x; c.y = s.y;
  integrate(c, 0, PHYSICS_DT, 45, P);
  c.mult = 3; shove(c);
  const f2 = integrate(c, 0, PHYSICS_DT, 45, P);
  assert.ok(f2 & WENT_OFF); assert.equal(f2 & OFF_FREE, 0); assert.equal(c.mult, 1);
  // a new stage (placeCar) resets the counter
  placeCar(c, track.samples[0]);
  assert.equal(c.offUsed, 0);
});
