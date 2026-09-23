// Stage seeds, the track ramp, scores and the storage keys. Pure.

import { TIMER } from "./timer.js";

/** Stage n of a day is its own track: a distinct geometry from the daily one and every other stage. */
export const stageSeed = (day, n) => day + "#run" + n;

// The track ramp: how many real corners (the guide heuristic's count) a stage
// must have. Stage 1 asks for 4 — the daily generator's median is about 5, so
// the dull one-corner layouts are the only ones it refuses. The floor climbs
// to 9 by the timer's knee and holds there: the generator finds 9 on almost
// every seed with its existing harmonics, and 11 is where it starts failing.
// Corners, not tighter corners: minR stays at 185, the radius the road width,
// the physics and the simulator's nearest-point window all assume.
export const RAMP = { corners: 4, cornersMax: 9 };

/** The generator target for stage n: { minR, corners }. */
export function stageShape(n) {
  const rise = (RAMP.cornersMax - RAMP.corners) / (TIMER.knee - 1);
  return { minR: 185, corners: Math.min(RAMP.cornersMax, RAMP.corners + Math.floor((n - 1) * rise)) };
}

/** Does score a beat score b? More stages cleared, then further into the fatal stage. Anything beats null. */
export function beats(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  return a.stages !== b.stages ? a.stages > b.stages : a.prog > b.prog;
}

/** A stored score, or null if the JSON is missing, corrupt or not a score. */
export function parseBest(json) {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v) || !Number.isFinite(v.stages)) return null;
    return { ...v, stages: v.stages, prog: Number.isFinite(v.prog) ? v.prog : 0, picks: Array.isArray(v.picks) ? v.picks : [] };
  } catch { return null; }
}

export const bestKeyDay = day => "neondrift:run:" + day + ":best";
export const BEST_KEY_ALL = "neondrift:run:best";
