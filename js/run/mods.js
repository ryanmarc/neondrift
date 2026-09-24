// The run's mods: each one a trade, applied to a *build* — a copy of the
// physics table plus the run's own knobs. Pure: no DOM, no state. Every number
// here is a first guess; tune by editing this file.

import { T } from "../config/tuning.js";
import { TIMER } from "./timer.js";

/** The rule set a run drives under. With no picks it is the daily race, plus the run's own keys at stock. */
export function baseBuild() {
  return {
    T: { ...T, multOffKeep: 0.5,   // car physics; a run keeps half the chain on a wall — the chain is its lifeline
         slideSpeed: 210, boostSteer: false, multSpeed: 0, offFree: 0 },   // dynamics.js's optional keys, at their stock values
    halfW: 1,             // road half-width multiplier, applied when a stage loads
    drain: 1, refill: 1, bonus: 1, cap: 1,   // timer multipliers; cap is 1 + seconds/TIMER.cap so cards add seconds
    refillFloorMult: 0,   // the timer refills only while car.mult >= this
    offTax: 0,            // seconds lost per off-track excursion (0 = none)
    lapScale: 1,          // stage geometry scale, applied on the next stage load
    spanScale: 1,         // camera world-span multiplier (under 1 = closer)
    hideClock: false,     // the clock readout is hidden until it is low
    skip: 1,              // Skip pays TIMER.skip × this
    lump: 0,              // seconds paid at pick time, in total; pick() applies the change
    knee: TIMER.knee,     // the stage the drain creep starts at
    lives: 0,             // second winds this run
    startBoost: 0,        // fraction of boostCap the car starts every stage with
    bonusFlat: 0,         // seconds added to every stage clear
  };
}

const pct = (b, key, p) => { b.T[key] *= 1 + p; };
const capSec = (b, s) => { b.cap += s / TIMER.cap; };   // the clock's cap in seconds, additive so cards stack exactly

/**
 * { id, name, kind, max, gain, cost, apply(build, level) }. `max` is how many
 * times it can be held; apply() is called once per pick, so levels compound
 * unless apply() sets a value for the level. `kind` is what the card touches;
 * the offer guarantees a car or character card. Character and pure cards
 * carry no cost line: a character card's trade is emergent from the physics
 * (a wider drift angle scrubs more speed by itself), a pure card's cost is the
 * pick it displaced. Every other card's cost is in a different currency than
 * its gain, and no card makes the clock drain faster.
 *
 * Where two cards set the same key (Off-road tax and Snowball on multOffKeep)
 * the later pick wins. Caps take the tightest held (Hot chain, Lock).
 */
export const MODS = [
  // ---- the car
  { id: "loose", name: "Loose", kind: "car", max: 3,
    gain: "The back steps out much further; slides last.", cost: "Longer slides scrub more speed.",
    apply(b) { pct(b, "gripSlide", -0.30); } },
  { id: "turbo", name: "Turbo", kind: "car", max: 3,
    gain: "Boost hits 30% harder and tops out 15% higher.", cost: "Steering is 10% slower.",
    apply(b) { pct(b, "boostSpeed", 0.15); pct(b, "boostAccel", 0.30); pct(b, "turn", -0.10); } },
  { id: "tank", name: "Long tank", kind: "car", max: 2,
    gain: "Boost meter holds 50% more.", cost: "The clock holds 3 seconds less.",
    apply(b) { pct(b, "boostCap", 0.50); capSec(b, -3); } },
  { id: "quick", name: "Quick charge", kind: "car", max: 2,
    gain: "Traction breaks in half the time.", cost: "Grip comes back 50% slower on release.",
    apply(b) { pct(b, "chargeUp", -0.50); pct(b, "chargeDown", 0.50); } },
  { id: "sticky", name: "Sticky", kind: "car", max: 2,
    gain: "Grip +35%: gentle bends without sliding.", cost: "A slide only counts above a higher speed.",
    apply(b, level) { pct(b, "gripMax", 0.35); pct(b, "stiffness", 0.25); b.T.slideSpeed = level === 1 ? 300 : 360; } },
  { id: "light", name: "Light", kind: "car", max: 2,
    gain: "Thrust +30%: quicker off the line and out of corners.", cost: "Off-track drag is doubled.",
    apply(b) { pct(b, "accel", 0.30); b.T.offDrag *= 2; } },
  { id: "hot", name: "Hot chain", kind: "car", max: 2,
    gain: "The chain builds 2× faster.", cost: "It caps at ×3, then ×2.5.",
    apply(b, level) { b.T.multRise *= 2; b.T.multCap = Math.min(b.T.multCap, level === 1 ? 3 : 2.5); } },
  { id: "angle", name: "Wide angle", kind: "car", max: 1,
    gain: "Drifts settle near 65°, not 50°.", cost: "The camera sits 15% closer.",
    apply(b) { pct(b, "alignFloor", -0.50); pct(b, "align", -0.15); b.spanScale *= 0.85; } },
  // ---- character: a different car, no cost line
  { id: "fishtail", name: "Fishtail", kind: "character", max: 1,
    gain: "The nose overshoots and swings back on every release.", cost: "",
    apply(b) { b.T.zeta = 0.22; } },
  { id: "ice", name: "Ice", kind: "character", max: 1,
    gain: "Grip −45%: the car slides a little in every corner, even without holding.", cost: "",
    apply(b) { pct(b, "gripMax", -0.45); pct(b, "stiffness", -0.30); } },
  { id: "boat", name: "Boat", kind: "character", max: 1,
    gain: "Sliding costs almost no speed, but steering is 25% slower and grip returns 40% slower.", cost: "",
    apply(b) { b.T.slipCost = 0.05; b.T.scrub *= 0.5; pct(b, "turn", -0.25); pct(b, "chargeDown", 0.40); } },
  { id: "twitch", name: "Twitch", kind: "character", max: 1,
    gain: "Steering +40% and traction breaks almost instantly, but drifts are short.", cost: "",
    apply(b) { pct(b, "turn", 0.40); b.T.chargeUp = 0.08; pct(b, "gripSlide", 0.30); } },
  { id: "rocket", name: "Rocket", kind: "character", max: 2,
    gain: "Boost is twice as hard and drains twice as fast: short, violent shoves.", cost: "",
    apply(b) { b.T.boostAccel *= 2; b.T.boostDrain *= 2; } },
  { id: "glide", name: "Glide", kind: "character", max: 2,
    gain: "Boost lasts three times as long at half the thrust: a long, gentle pull.", cost: "",
    apply(b) { b.T.boostDrain *= 0.35; b.T.boostAccel *= 0.5; } },
  { id: "afterburner", name: "Afterburner", kind: "character", max: 1,
    gain: "Boost keeps firing while you steer. The meter fills half as fast.", cost: "",
    apply(b) { b.T.boostSteer = true; b.T.boostFill *= 0.5; } },
  { id: "snowball", name: "Snowball", kind: "character", max: 2,
    gain: "Top speed +6% per ×1 of chain. A wall resets the chain fully.", cost: "",
    apply(b) { b.T.multSpeed += 0.06; b.T.multOffKeep = 0; } },
  // ---- the clock and the chain
  { id: "slow", name: "Slow burn", kind: "clock", max: 2,
    gain: "The clock drains 15% slower.", cost: "It can hold 5 seconds less.",
    apply(b) { b.drain *= 0.85; capSec(b, -5); } },
  { id: "deep", name: "Deep tank", kind: "clock", max: 2,
    gain: "The clock can hold 8 seconds more.", cost: "Clearing a stage pays 30% less.",
    apply(b) { capSec(b, 8); b.bonus *= 0.70; } },
  { id: "overtime", name: "Overtime", kind: "clock", max: 2,
    gain: "Clearing a stage pays 60% more.", cost: "−5 seconds, right now.",
    apply(b) { b.bonus *= 1.60; b.lump -= 5; } },
  { id: "roller", name: "High roller", kind: "clock", max: 1,
    gain: "Slides refill the clock 60% faster.", cost: "Only from a ×2 chain up. Below that, nothing.",
    apply(b) { b.refill *= 1.6; b.refillFloorMult = 2; } },
  { id: "lock", name: "Lock", kind: "clock", max: 1,
    gain: "The chain never decays between slides.", cost: "It caps at ×3.",
    apply(b) { b.T.multFall = 0; b.T.multCap = Math.min(b.T.multCap, 3); } },
  { id: "blindfold", name: "Blindfold", kind: "clock", max: 1,
    gain: "The clock drains 25% slower.", cost: "You can't see it. Only the low warning shows.",
    apply(b) { b.drain *= 0.75; b.hideClock = true; } },
  { id: "wind", name: "Second wind", kind: "clock", max: 1,
    gain: "Once per run, hitting zero refills to 8 seconds instead of ending.", cost: "The late drain starts climbing from stage 6.",
    apply(b) { b.lives = 1; b.knee = 6; } },
  // ---- the road (takes effect on the next stage)
  { id: "wide", name: "Wide road", kind: "road", max: 2,
    gain: "The road is 15% wider.", cost: "Stages are 20% longer, corners gentler by the same.",
    apply(b) { b.halfW *= 1.15; b.lapScale *= 1.2; } },
  { id: "tight", name: "Tight road", kind: "road", max: 2,
    gain: "Clearing a stage pays 50% more.", cost: "The road is 12% narrower.",
    apply(b) { b.bonus *= 1.50; b.halfW *= 0.88; } },
  // ---- the rules
  { id: "offtax", name: "Off-road tax", kind: "rules", max: 1,
    gain: "Leaving the road no longer breaks your chain.", cost: "Every excursion costs 2 seconds instead.",
    apply(b) { b.T.multOffKeep = 1; b.offTax = 2; } },
  { id: "lowbar", name: "Low bar", kind: "rules", max: 1,
    gain: "Small slides count as drifting.", cost: "Skip pays nothing for the rest of the run.",
    apply(b) { pct(b, "driftMin", -0.40); b.skip = 0; } },
  // ---- pure upsides: no cost line, half weight in the offer
  { id: "kickstart", name: "Kickstart", kind: "pure", max: 1,
    gain: "Every stage starts with a full boost meter.", cost: "",
    apply(b) { b.startBoost = 1; } },
  { id: "insurance", name: "Insurance", kind: "pure", max: 2,
    gain: "The first excursion each stage keeps the chain and costs nothing.", cost: "",
    apply(b, level) { b.T.offFree = level; } },
  { id: "breather", name: "Breather", kind: "pure", max: 2,
    gain: "+2 seconds on every stage clear.", cost: "",
    apply(b) { b.bonusFlat += 2; } },
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
