import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { T } = await import(new URL("config/tuning.js", root));
const { MODS, SKIP, byId, baseBuild, held, canPick, buildFrom } = await import(new URL("run/mods.js", root));

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || (a + " ≠ " + b));

test("an empty build is the daily race, except a wall keeps half the chain, plus the run's own keys at stock", () => {
  const b = buildFrom([]);
  const { slideSpeed, boostSteer, multSpeed, offFree, ...rest } = b.T;
  assert.deepEqual({ ...rest, multOffKeep: 0 }, T);
  assert.deepEqual({ slideSpeed, boostSteer, multSpeed, offFree }, { slideSpeed: 210, boostSteer: false, multSpeed: 0, offFree: 0 });
  assert.equal(b.T.multOffKeep, 0.5);
  assert.notEqual(b.T, T, "must be a copy, never T itself");
  assert.deepEqual({ ...b, T: null }, { ...baseBuild(), T: null });
  assert.deepEqual({ ...b, T: undefined }, {
    T: undefined, halfW: 1, drain: 1, refill: 1, bonus: 1, cap: 1, refillFloorMult: 0, offTax: 0,
    lapScale: 1, spanScale: 1, hideClock: false, skip: 1, lump: 0, knee: 8, lives: 0, startBoost: 0, bonusFlat: 0,
  });
});

const KINDS = new Set(["car", "character", "clock", "road", "rules", "pure"]);

test("the catalogue is well-formed: 30 cards, every old id, a kind each, costs only where the spec says", () => {
  assert.equal(MODS.length, 30);
  for (const id of ["loose", "turbo", "tank", "quick", "sticky", "light", "hot", "angle", "slow", "deep", "overtime", "roller", "wide", "tight", "offtax", "lowbar"])
    assert.ok(byId.has(id), "lost " + id);
  const ids = new Set();
  for (const m of MODS) {
    assert.ok(!ids.has(m.id), "duplicate id " + m.id); ids.add(m.id);
    assert.ok(m.name && m.gain, m.id + " needs name and gain");
    assert.ok(KINDS.has(m.kind), m.id + " kind " + m.kind);
    if (m.kind === "character" || m.kind === "pure") assert.equal(m.cost, "", m.id + " carries no cost line");
    else assert.ok(m.cost, m.id + " needs a cost");
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

test("no card drains the clock faster", () => {
  for (const m of MODS) assert.ok(buildFrom([m.id]).drain <= 1, m.id);
});

test("levels compound by re-applying, except where a level sets a value", () => {
  close(buildFrom(["loose"]).T.gripSlide, T.gripSlide * 0.70);
  close(buildFrom(["loose", "loose"]).T.gripSlide, T.gripSlide * 0.70 * 0.70);
  assert.equal(buildFrom(["sticky"]).T.slideSpeed, 300);
  assert.equal(buildFrom(["sticky", "sticky"]).T.slideSpeed, 360);
  assert.equal(buildFrom(["hot"]).T.multCap, 3);
  assert.equal(buildFrom(["hot", "hot"]).T.multCap, 2.5);
});

test("the chain cap is the tightest held, in any order", () => {
  assert.equal(buildFrom(["hot", "lock"]).T.multCap, 3);
  assert.equal(buildFrom(["lock", "hot"]).T.multCap, 3);
  assert.equal(buildFrom(["lock", "hot", "hot"]).T.multCap, 2.5);
  assert.equal(buildFrom(["hot", "hot", "lock"]).T.multCap, 2.5);
});

test("the car cards", () => {
  const t = buildFrom(["turbo"]); close(t.T.boostSpeed, T.boostSpeed * 1.15); close(t.T.boostAccel, T.boostAccel * 1.30); close(t.T.turn, T.turn * 0.90);
  const k = buildFrom(["tank"]); close(k.T.boostCap, T.boostCap * 1.5); close(k.cap, 1 - 3 / 30);
  const q = buildFrom(["quick"]); close(q.T.chargeUp, T.chargeUp * 0.5); close(q.T.chargeDown, T.chargeDown * 1.5);
  const s = buildFrom(["sticky"]); close(s.T.gripMax, T.gripMax * 1.35); close(s.T.stiffness, T.stiffness * 1.25);
  const l = buildFrom(["light"]); close(l.T.accel, T.accel * 1.30); close(l.T.offDrag, T.offDrag * 2);
  const h = buildFrom(["hot"]); close(h.T.multRise, T.multRise * 2);
  const a = buildFrom(["angle"]); close(a.T.alignFloor, T.alignFloor * 0.5); close(a.T.align, T.align * 0.85); close(a.spanScale, 0.85);
});

test("the character cards", () => {
  close(buildFrom(["fishtail"]).T.zeta, 0.22);
  const i = buildFrom(["ice"]); close(i.T.gripMax, T.gripMax * 0.55); close(i.T.stiffness, T.stiffness * 0.70);
  const b = buildFrom(["boat"]); close(b.T.slipCost, 0.05); close(b.T.scrub, T.scrub * 0.5); close(b.T.turn, T.turn * 0.75); close(b.T.chargeDown, T.chargeDown * 1.4);
  const w = buildFrom(["twitch"]); close(w.T.turn, T.turn * 1.4); close(w.T.chargeUp, 0.08); close(w.T.gripSlide, T.gripSlide * 1.3);
  const r = buildFrom(["rocket"]); close(r.T.boostAccel, T.boostAccel * 2); close(r.T.boostDrain, T.boostDrain * 2);
  const g = buildFrom(["glide"]); close(g.T.boostDrain, T.boostDrain * 0.35); close(g.T.boostAccel, T.boostAccel * 0.5);
  const f = buildFrom(["afterburner"]); assert.equal(f.T.boostSteer, true); close(f.T.boostFill, T.boostFill * 0.5);
  const n = buildFrom(["snowball"]); close(n.T.multSpeed, 0.06); assert.equal(n.T.multOffKeep, 0);
  close(buildFrom(["snowball", "snowball"]).T.multSpeed, 0.12);
});

test("the clock, road, rules and pure cards", () => {
  const s = buildFrom(["slow"]); close(s.drain, 0.85); close(s.cap, 1 - 5 / 30);
  const d = buildFrom(["deep"]); close(d.cap, 1 + 8 / 30); close(d.bonus, 0.70);
  const o = buildFrom(["overtime"]); close(o.bonus, 1.6); close(o.lump, -5);
  close(buildFrom(["overtime", "overtime"]).lump, -10);
  const r = buildFrom(["roller"]); close(r.refill, 1.6); assert.equal(r.refillFloorMult, 2);
  const k = buildFrom(["lock"]); assert.equal(k.T.multFall, 0); assert.equal(k.T.multCap, 3);
  const b = buildFrom(["blindfold"]); close(b.drain, 0.75); assert.equal(b.hideClock, true);
  const w = buildFrom(["wind"]); assert.equal(w.lives, 1); assert.equal(w.knee, 6);
  const wd = buildFrom(["wide"]); close(wd.halfW, 1.15); close(wd.lapScale, 1.2);
  const t = buildFrom(["tight"]); close(t.bonus, 1.5); close(t.halfW, 0.88);
  const x = buildFrom(["offtax"]); assert.equal(x.T.multOffKeep, 1); assert.equal(x.offTax, 2);
  const lb = buildFrom(["lowbar"]); close(lb.T.driftMin, T.driftMin * 0.6); assert.equal(lb.skip, 0);
  assert.equal(buildFrom(["kickstart"]).startBoost, 1);
  assert.equal(buildFrom(["insurance"]).T.offFree, 1);
  assert.equal(buildFrom(["insurance", "insurance"]).T.offFree, 2);
  assert.equal(buildFrom(["breather", "breather"]).bonusFlat, 4);
});

test("skip entries and unknown ids are ignored by buildFrom", () => {
  assert.deepEqual(buildFrom(["skip", "nope", "skip"]), baseBuild());
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

test("Snowball's wall reset yields to Off-road tax in either order: the tax already charges for the wall", () => {
  for (const picks of [["offtax", "snowball"], ["snowball", "offtax"]]) {
    const b = buildFrom(picks);
    assert.equal(b.T.multOffKeep, 1, picks.join(","));
    assert.equal(b.offTax, 2, picks.join(","));
  }
  assert.equal(buildFrom(["snowball"]).T.multOffKeep, 0);
});
