import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { T } = await import(new URL("config/tuning.js", root));
const { ENGINE, createModel, stepEngine } = await import(new URL("audio/engine.js", root));

const DT = 1 / 60;
const inp = (speed, over = {}) => ({ speed, boosting: false, drift: 0, ...over });
// Hold an input for `secs` and return the last output.
const hold = (m, input, secs) => { let o; for (let i = 0; i < secs * 60; i++) o = stepEngine(m, input, DT); return o; };
// Accelerate 0 → speed over `secs`, calling fn(out, speed) each step.
const ramp = (m, to, secs, fn, over = {}) => {
  const n = secs * 60;
  for (let i = 1; i <= n; i++) { const v = to * i / n; fn(stepEngine(m, inp(v, over), DT), v); }
};

test("it climbs through every gear on the way to boost speed, and revs drop at each shift", () => {
  const m = createModel();
  const shifts = [];
  let prev = null;
  ramp(m, T.boostSpeed, 8, (o) => {
    if (prev && m.gear !== prev.gear) shifts.push({ from: prev.gear, to: m.gear, before: prev.rpm, after: m.rpm });
    prev = { gear: m.gear, rpm: m.rpm };
  }, { boosting: true });
  assert.equal(shifts.length, ENGINE.gears.length - 1, "one upshift per gear: " + JSON.stringify(shifts));
  for (const s of shifts) {
    assert.equal(s.to, s.from + 1);
    assert.ok(s.after < s.before, "revs must fall on the shift " + s.from + "→" + s.to);
  }
  assert.equal(m.gear, ENGINE.gears.length);
  assert.ok(m.rpm < 1 && m.rpm > 0.8, "top gear at boost speed sits just under the redline, not past it: " + m.rpm);
});

test("a dip just under the shift point does not downshift (hysteresis)", () => {
  const m = createModel();
  ramp(m, T.maxSpeed * 0.5, 4, () => {});
  const g = m.gear;
  assert.ok(g > 1);
  hold(m, inp(T.maxSpeed * 0.5 * 0.96), 1);
  assert.equal(m.gear, g, "a 4% dip should hold the gear");
  hold(m, inp(T.maxSpeed * 0.5 * 0.5), 1);
  assert.ok(m.gear < g, "halving the speed must downshift");
});

test("the firing rate rises with revs and never leaves its band", () => {
  const m = createModel();
  let lo = Infinity, hi = -Infinity, prevRpm = 0, prevHz = 0, monotone = true;
  ramp(m, T.boostSpeed, 8, (o) => {
    lo = Math.min(lo, o.fireHz); hi = Math.max(hi, o.fireHz);
    if (m.rpm > prevRpm && o.fireHz < prevHz) monotone = false;
    prevRpm = m.rpm; prevHz = o.fireHz;
  }, { boosting: true });
  assert.ok(lo >= ENGINE.fireIdle - 1e-9 && hi <= ENGINE.fireRed + 1e-9, lo + ".." + hi);
  assert.ok(monotone, "firing rate must follow revs within a gear");
});

test("load: boost is full throttle, a slide is overrun, cruise sits between", () => {
  const cruise = hold(createModel(), inp(T.maxSpeed), 3);
  const boost = hold(createModel(), inp(T.maxSpeed, { boosting: true }), 3);
  const slide = hold(createModel(), inp(T.maxSpeed, { drift: 0.6 }), 3);
  assert.ok(boost.load > cruise.load && cruise.load > slide.load, JSON.stringify({ boost, cruise, slide }));
  assert.ok(slide.load < 0.15, "overrun is nearly closed throttle");
  assert.ok(boost.load > 0.9, "boost is wide open");
});

test("accelerating hard reads as throttle even without boost", () => {
  const m = createModel();
  let o;
  ramp(m, T.maxSpeed * 0.4, 1.5, (x) => { o = x; });   // a brisk pull
  assert.ok(o.load > 0.6, "pulling away is load: " + o.load);
});

test("load opens the filter and raises the level at the same revs", () => {
  const a = createModel(), b = createModel();
  const on = hold(a, inp(T.maxSpeed * 0.6, { boosting: true }), 3);
  const off = hold(b, inp(T.maxSpeed * 0.6, { drift: 0.6 }), 3);
  assert.equal(a.gear, b.gear);
  assert.ok(on.cutoff > off.cutoff * 1.5, "load must brighten it: " + on.cutoff + " vs " + off.cutoff);
  assert.ok(on.gain > off.gain * 1.5, "load must lift it: " + on.gain + " vs " + off.gain);
  assert.ok(off.gain > 0, "overrun still burbles");
});

test("a slide that starts at speed pops once; one at a standstill does not", () => {
  const m = createModel();
  hold(m, inp(T.maxSpeed), 2);
  const pops = [];
  for (let i = 0; i < 30; i++) pops.push(stepEngine(m, inp(T.maxSpeed * 0.9, { drift: 0.6 }), DT).pop);
  assert.equal(pops.filter(Boolean).length, 1, "exactly one pop across the slide: " + pops.join(""));
  const still = createModel();
  hold(still, inp(0), 1);
  assert.ok(!stepEngine(still, inp(0, { drift: 0.6 }), DT).pop, "no pop from a standstill");
});

test("the shift lifts the throttle for a moment", () => {
  const m = createModel();
  let minLoadNearShift = 1, sawShift = false, since = 99;
  ramp(m, T.boostSpeed, 8, (o) => {
    if (m.lift > 0 && !sawShift) { sawShift = true; }
    if (m.lift > 0) since = 0; else since += DT;
    if (since < 0.1) minLoadNearShift = Math.min(minLoadNearShift, o.load);
  }, { boosting: true });
  assert.ok(sawShift, "the ramp must shift");
  assert.ok(minLoadNearShift < 0.6, "load should dip through the shift: " + minLoadNearShift);
});
