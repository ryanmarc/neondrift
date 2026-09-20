// An input schedule: when to hold the button, expressed in track progress rather
// than time. Progress is "laps completed + fraction of the current lap" (0..LAPS),
// so a schedule is robust to timing changes earlier in the run — moving one
// corner's entry doesn't misalign every corner after it — and every marker
// already has a position on the track.
//
// A schedule is a sorted array of non-overlapping segments { a, b, dir }:
// hold `dir` (-1 left, +1 right) while a <= progress < b.

import { LAPS } from "../config/tuning.js";


/**
 * A stateful reader: call it with the car's total progress every step and it
 * returns the steering input. Once a segment has been entered it stays active
 * until progress reaches its end, so the one-sample backward wobble that the
 * nearest-point index makes in a slide can't release the button early.
 */
export function createInput(schedule) {
  let i = 0, active = false;
  return (P) => {
    while (i < schedule.length && P >= schedule[i].b) { i++; active = false; }
    if (i >= schedule.length) return 0;
    if (!active && P >= schedule[i].a) active = true;
    return active ? schedule[i].dir : 0;
  };
}

/** Sort, clamp, drop slivers and resolve overlaps. Returns a new array. */
export function normalize(schedule) {
  const segs = schedule
    .map(s => ({ a: Math.max(0, s.a), b: Math.min(LAPS, s.b), dir: s.dir }))
    .filter(s => s.b > s.a)
    .sort((x, y) => x.a - y.a);
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.a < prev.b) {
      if (s.dir === prev.dir) { prev.b = Math.max(prev.b, s.b); continue; }
      s.a = prev.b;
      if (s.b <= s.a) continue;
    }
    out.push(s);
  }
  return out;
}

/** Standard normal via Box-Muller, from a [0,1) rng. */
function gaussian(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One random edit. sigma is the scale of endpoint moves in progress units
 * (0.01 ≈ 1% of a lap ≈ 100px). Returns a new normalized schedule.
 */
export function mutate(schedule, rng, sigma) {
  const segs = schedule.map(s => ({ ...s }));
  const r = rng();
  const pick = () => segs[Math.floor(rng() * segs.length)];
  if (segs.length === 0 || r < 0.05) {
    // add a short tap somewhere
    const a = rng() * LAPS, len = 0.005 + rng() * 0.03;
    segs.push({ a, b: a + len, dir: rng() < 0.5 ? -1 : 1 });
  } else if (r < 0.75) {
    // nudge one endpoint
    const s = pick();
    if (rng() < 0.5) s.a += gaussian(rng) * sigma; else s.b += gaussian(rng) * sigma;
  } else if (r < 0.85) {
    // slide a whole segment
    const s = pick(), d = gaussian(rng) * sigma;
    s.a += d; s.b += d;
  } else if (r < 0.90) {
    // split: release briefly in the middle of a hold (lets a double-tap emerge)
    const s = pick(), mid = s.a + (0.2 + 0.6 * rng()) * (s.b - s.a), gap = 0.004 + rng() * 0.02;
    segs.push({ a: mid + gap, b: s.b, dir: s.dir });
    s.b = mid;
  } else if (r < 0.95 && segs.length > 1) {
    segs.splice(Math.floor(rng() * segs.length), 1);
  } else {
    pick().dir *= -1;
  }
  return normalize(segs);
}
