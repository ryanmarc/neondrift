// The run's mods: each one a trade, applied to a *build* — a copy of the
// physics table plus the run's own knobs. Pure: no DOM, no state. Every number
// here is a first guess; tune by editing this file.

import { T } from "../config/tuning.js";

/** The rule set a run drives under. With no picks it is the daily race. */
export function baseBuild() {
  return {
    T: { ...T, multOffKeep: 0.5 },   // car physics; a run keeps half the chain on a wall — the chain is its lifeline
    halfW: 1,             // road half-width multiplier, applied when a stage loads
    drain: 1, refill: 1, bonus: 1, cap: 1,   // timer multipliers
    refillFloorMult: 0,   // the timer refills only while car.mult >= this
    offTax: 0,            // seconds lost per off-track excursion (0 = none)
  };
}

const pct = (b, key, p) => { b.T[key] *= 1 + p; };

/**
 * { id, name, gain, cost, max, apply(build, level) }. `max` is how many times
 * it can be held; apply() is called once per pick, so levels compound.
 */
export const MODS = [
  // ---- the car
  { id: "loose", name: "Loose", max: 3,
    gain: "The back steps out further; chains build sooner.", cost: "Top speed −3%.",
    apply(b) { pct(b, "gripSlide", -0.15); pct(b, "maxSpeed", -0.03); } },
  { id: "turbo", name: "Turbo", max: 3,
    gain: "Boost hits harder and tops out higher.", cost: "The clock drains 8% faster.",
    apply(b) { pct(b, "boostSpeed", 0.06); pct(b, "boostAccel", 0.08); b.drain *= 1.08; } },
  { id: "tank", name: "Long tank", max: 2,
    gain: "Boost meter holds 35% more.", cost: "It fills 15% slower.",
    apply(b) { pct(b, "boostCap", 0.35); pct(b, "boostFill", -0.15); } },
  { id: "quick", name: "Quick charge", max: 2,
    gain: "Traction breaks sooner when you hold.", cost: "Grip comes back 30% slower on release.",
    apply(b) { pct(b, "chargeUp", -0.25); pct(b, "chargeDown", 0.30); } },
  { id: "sticky", name: "Sticky", max: 2,
    gain: "More grip: cleaner corners without sliding.", cost: "Slides refill the clock 12% slower.",
    apply(b) { pct(b, "gripMax", 0.20); pct(b, "stiffness", 0.15); b.refill *= 0.88; } },
  { id: "light", name: "Light", max: 2,
    gain: "Quicker off the line and out of corners.", cost: "Going sideways costs 25% more speed.",
    apply(b) { pct(b, "accel", 0.15); pct(b, "slipCost", 0.25); } },
  { id: "hot", name: "Hot chain", max: 2,
    gain: "The chain builds 1.5× faster.", cost: "It decays 2.5× faster between slides.",
    apply(b) { b.T.multRise *= 1.5; b.T.multFall *= 2.5; } },
  { id: "angle", name: "Wide angle", max: 1,
    gain: "Drifts hold at wider angles.", cost: "Steering is 12% slower.",
    apply(b) { pct(b, "alignFloor", -0.40); pct(b, "turn", -0.12); } },
  // ---- the clock
  { id: "slow", name: "Slow burn", max: 2,
    gain: "The clock drains 12% slower.", cost: "It can hold 4 seconds less.",
    apply(b) { b.drain *= 0.88; b.cap *= 1 - 4 / 30; } },
  { id: "deep", name: "Deep tank", max: 2,
    gain: "The clock can hold 6 seconds more.", cost: "Clearing a stage pays 30% less.",
    apply(b) { b.cap *= 1 + 6 / 30; b.bonus *= 0.70; } },
  { id: "overtime", name: "Overtime", max: 2,
    gain: "Clearing a stage pays 60% more.", cost: "The clock drains 10% faster.",
    apply(b) { b.bonus *= 1.60; b.drain *= 1.10; } },
  { id: "roller", name: "High roller", max: 1,
    gain: "Slides refill the clock at double rate.", cost: "Only from a ×2 chain up. Below that, nothing.",
    apply(b) { b.refill *= 2; b.refillFloorMult = 2; } },
  // ---- the road (takes effect on the next stage)
  { id: "wide", name: "Wide road", max: 2,
    gain: "The road is 12% wider.", cost: "The clock drains 8% faster.",
    apply(b) { b.halfW *= 1.12; b.drain *= 1.08; } },
  { id: "tight", name: "Tight road", max: 2,
    gain: "Clearing a stage pays 50% more.", cost: "The road is 12% narrower.",
    apply(b) { b.bonus *= 1.50; b.halfW *= 0.88; } },
  // ---- the rules
  { id: "offtax", name: "Off-road tax", max: 1,
    gain: "Leaving the road no longer breaks your chain.", cost: "Every excursion costs 2 seconds instead.",
    apply(b) { b.T.multOffKeep = 1; b.offTax = 2; } },
  { id: "lowbar", name: "Low bar", max: 1,
    gain: "Small slides count as drifting.", cost: "Boost fills 20% slower.",
    apply(b) { pct(b, "driftMin", -0.40); pct(b, "boostFill", -0.20); } },
];

/** The fourth card on every offer: no mod, a few seconds now. Recorded in picks, never a held mod. */
export const SKIP = { id: "skip", name: "Skip", gain: "+4 seconds on the clock, nothing else.", cost: "", max: 0 };

export const byId = new Map(MODS.map(m => [m.id, m]));

/** How many times `id` appears in `picks`. */
export function held(picks, id) {
  let n = 0;
  for (const p of picks) if (p === id) n++;
  return n;
}

/** Can `id` be picked given what is already held? Skip always can. */
export function canPick(picks, id) {
  if (id === SKIP.id) return true;
  const m = byId.get(id);
  return !!m && held(picks, id) < m.max;
}

/** Fold every pick over a fresh base build. Skips and unknown ids are ignored. */
export function buildFrom(picks) {
  const b = baseBuild();
  const counts = {};
  for (const id of picks) {
    const m = byId.get(id);
    if (!m) continue;
    counts[id] = (counts[id] || 0) + 1;
    m.apply(b, counts[id]);
  }
  return b;
}
