import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { T, PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { SLIDING, WENT_OFF, OFF_FREE } = await import(new URL("game/dynamics.js", root));
const { buildFrom } = await import(new URL("run/mods.js", root));
const { TIMER, drainRate, capFor, tickTimer, addBonus, addLump } = await import(new URL("run/timer.js", root));

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + " ≠ " + b);
const fresh = (over = {}) => ({ timer: TIMER.start, stage: 1, build: buildFrom([]), lowArmed: true, livesUsed: 0, ...over });
const carAt = (mult, drift = 0.8, speed = T.maxSpeed) => ({ mult, drift, vx: speed, vy: 0 });
const second = (run, flags, car) => { let r; for (let i = 0; i < 120; i++) r = tickTimer(run, flags, car, PHYSICS_DT); return r; };

test("drains one second per second on stage 1, ramped on later stages", () => {
  const run = fresh();
  second(run, 0, carAt(1));
  close(run.timer, TIMER.start - 1, 1e-6);
  close(drainRate(10, buildFrom([])), 1 + (TIMER.drainMax - 1) * (1 - Math.pow(TIMER.rampK, 9)) + TIMER.creep * (10 - TIMER.knee));
  assert.ok(drainRate(TIMER.knee, buildFrom([])) < TIMER.drainMax, "a knee, not a cliff, in the early stages");
  assert.ok(drainRate(9, buildFrom([])) > drainRate(8, buildFrom([])), "it rises every stage");
  assert.ok(drainRate(60, buildFrom([])) > 5, "and without bound, so every build ends");
  close(drainRate(1, buildFrom(["turbo"])), 1.08);
});

test("refills only while SLIDING and only above the refill floor", () => {
  const a = fresh(); second(a, SLIDING, carAt(2));
  const b = fresh(); second(b, 0, carAt(2));
  assert.ok(a.timer > b.timer, "sliding must refill");
  const r = fresh({ build: buildFrom(["roller"]) });
  second(r, SLIDING, carAt(1));
  close(r.timer, TIMER.start - 1, 1e-6);      // ×1 is below the floor: drain only
  const r2 = fresh({ build: buildFrom(["roller"]) });
  second(r2, SLIDING, carAt(2));
  assert.ok(r2.timer > TIMER.start, "×2 with roller refills faster");
});

test("a ×4 chain out-earns stage-1 drain; a ×1 slide roughly breaks even", () => {
  const four = fresh(); second(four, SLIDING, carAt(4));
  assert.ok(four.timer - TIMER.start > 2, "×4 should bank >2s per second, got " + (four.timer - TIMER.start));
  const one = fresh(); second(one, SLIDING, carAt(1));
  assert.ok(Math.abs(one.timer - TIMER.start) < 0.6, "×1 should be near break-even, got " + (one.timer - TIMER.start));
});

test("caps at cap × build.cap", () => {
  const run = fresh({ timer: TIMER.cap });
  second(run, SLIDING, carAt(4));
  close(run.timer, TIMER.cap);
  const deep = fresh({ build: buildFrom(["deep"]), timer: TIMER.cap });
  second(deep, SLIDING, carAt(4));
  assert.ok(deep.timer > TIMER.cap);
  close(capFor(deep.build), TIMER.cap * (1 + 6 / 30));
});

test("the off-road tax takes seconds on the step the car leaves the road", () => {
  const run = fresh({ build: buildFrom(["offtax"]) });
  tickTimer(run, WENT_OFF, carAt(1), PHYSICS_DT);
  close(run.timer, TIMER.start - 2 - PHYSICS_DT, 1e-6);
  const plain = fresh();
  tickTimer(plain, WENT_OFF, carAt(1), PHYSICS_DT);
  close(plain.timer, TIMER.start - PHYSICS_DT, 1e-6);
});

test("reports over exactly when the clock reaches zero and clamps there", () => {
  const run = fresh({ timer: PHYSICS_DT * 1.5 });
  assert.equal(tickTimer(run, 0, carAt(1), PHYSICS_DT).over, false);
  assert.equal(tickTimer(run, 0, carAt(1), PHYSICS_DT).over, true);
  assert.equal(run.timer, 0);
});

test("low fires once on the way down and re-arms above low + 2", () => {
  const run = fresh({ timer: TIMER.low + 0.001 });   // less than one step above the line
  const r1 = tickTimer(run, 0, carAt(1), PHYSICS_DT);
  assert.equal(r1.low, true);
  assert.equal(tickTimer(run, 0, carAt(1), PHYSICS_DT).low, false);
  addBonus(run, 10);
  assert.equal(run.lowArmed, false, "a bonus alone does not re-arm; the next tick does");
  tickTimer(run, 0, carAt(1), PHYSICS_DT);
  assert.equal(run.lowArmed, true);
  run.timer = TIMER.low + 0.001;
  assert.equal(tickTimer(run, 0, carAt(1), PHYSICS_DT).low, true);
});

test("addBonus caps", () => {
  const run = fresh({ timer: TIMER.cap - 1 });
  addBonus(run, 10);
  close(run.timer, TIMER.cap);
});

test("the drain creep starts at the build's knee", () => {
  const early = buildFrom([]); early.knee = 6;
  assert.ok(drainRate(7, early) > drainRate(7, buildFrom([])), "a lower knee drains sooner");
  close(drainRate(6, early), drainRate(6, buildFrom([])));
});

test("a free excursion (OFF_FREE) is not taxed", () => {
  const run = fresh({ build: buildFrom(["offtax"]) });
  tickTimer(run, WENT_OFF | OFF_FREE, carAt(1), PHYSICS_DT);
  close(run.timer, TIMER.start - PHYSICS_DT, 1e-6);
});

test("second wind: zero refills to TIMER.wind once per run, re-arms the low cue, then the next zero ends it", () => {
  const b = buildFrom([]); b.lives = 1;
  const run = fresh({ build: b, timer: PHYSICS_DT / 2, lowArmed: false, livesUsed: 0 });
  const r = tickTimer(run, 0, carAt(1), PHYSICS_DT);
  assert.equal(r.over, false); assert.equal(r.wind, true);
  close(run.timer, TIMER.wind); assert.equal(run.livesUsed, 1); assert.equal(run.lowArmed, true);
  run.timer = PHYSICS_DT / 2;
  const r2 = tickTimer(run, 0, carAt(1), PHYSICS_DT);
  assert.equal(r2.over, true); assert.equal(r2.wind, false); assert.equal(run.timer, 0);
});

test("a lump sum can leave one second but never zero, and never exceeds the cap", () => {
  const low = fresh({ timer: 3 });
  addLump(low, -5);
  close(low.timer, TIMER.lumpFloor);
  const high = fresh({ timer: TIMER.cap - 1 });
  addLump(high, 5);
  close(high.timer, TIMER.cap);
  const mid = fresh({ timer: 12 });
  addLump(mid, -5);
  close(mid.timer, 7);
});
