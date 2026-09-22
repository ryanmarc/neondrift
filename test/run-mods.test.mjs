import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { T } = await import(new URL("config/tuning.js", root));
const { MODS, SKIP, byId, baseBuild, held, canPick, buildFrom } = await import(new URL("run/mods.js", root));

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || (a + " ≠ " + b));

test("an empty build is the daily race", () => {
  const b = buildFrom([]);
  assert.deepEqual(b.T, T);
  assert.notEqual(b.T, T, "must be a copy, never T itself");
  assert.deepEqual({ ...b, T: null }, { ...baseBuild(), T: null });
  assert.equal(b.halfW, 1); assert.equal(b.drain, 1); assert.equal(b.refill, 1);
  assert.equal(b.bonus, 1); assert.equal(b.cap, 1); assert.equal(b.refillFloorMult, 0); assert.equal(b.offTax, 0);
});

test("the catalogue is well-formed", () => {
  assert.ok(MODS.length >= 16);
  const ids = new Set();
  for (const m of MODS) {
    assert.ok(!ids.has(m.id), "duplicate id " + m.id); ids.add(m.id);
    assert.ok(m.name && m.gain && m.cost, m.id + " needs name, gain, cost");
    assert.ok(Number.isInteger(m.max) && m.max >= 1, m.id + " needs max ≥ 1");
    assert.equal(typeof m.apply, "function");
    assert.equal(byId.get(m.id), m);
  }
  assert.equal(SKIP.id, "skip");
  assert.equal(SKIP.max, 0);
});

test("every mod changes the build", () => {
  const base = JSON.stringify(baseBuild());
  for (const m of MODS) assert.notEqual(JSON.stringify(buildFrom([m.id])), base, m.id + " did nothing");
});

test("levels compound by re-applying", () => {
  close(buildFrom(["loose"]).T.gripSlide, T.gripSlide * 0.85);
  close(buildFrom(["loose", "loose"]).T.gripSlide, T.gripSlide * 0.85 * 0.85);
  close(buildFrom(["loose", "loose"]).T.maxSpeed, T.maxSpeed * 0.97 * 0.97);
});

test("timer, road and rule mods land on the run knobs", () => {
  close(buildFrom(["turbo"]).drain, 1.08);
  close(buildFrom(["slow"]).cap, 1 - 4 / 30);
  close(buildFrom(["wide", "tight"]).halfW, 1.12 * 0.88);
  const r = buildFrom(["roller"]); assert.equal(r.refill, 2); assert.equal(r.refillFloorMult, 2);
  const o = buildFrom(["offtax"]); assert.equal(o.T.multResetOff, false); assert.equal(o.offTax, 2);
  const h = buildFrom(["hot"]); close(h.T.multRise, T.multRise * 1.5); close(h.T.multFall, T.multFall * 2.5);
});

test("skip entries and unknown ids are ignored by buildFrom", () => {
  assert.deepEqual(buildFrom(["skip", "nope", "skip"]).T, T);
});

test("held counts and canPick respects max", () => {
  assert.equal(held(["loose", "turbo", "loose"], "loose"), 2);
  assert.equal(canPick([], "loose"), true);
  assert.equal(canPick(["loose", "loose"], "loose"), true);
  assert.equal(canPick(["loose", "loose", "loose"], "loose"), false);
  assert.equal(canPick(["angle"], "angle"), false);
  assert.equal(canPick([], "skip"), true);
  assert.equal(canPick(["skip", "skip"], "skip"), true);
  assert.equal(canPick([], "nope"), false);
});
