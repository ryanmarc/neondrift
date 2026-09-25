// The current track: its samples, its identity, and geometry queries against it.

import { clamp } from "../core/math.js";
import { mulberry32, hashStr } from "../core/random.js";
import { emit } from "../core/events.js";
import { buildTrack } from "./generator.js";
import { HALF_W } from "../config/tuning.js";

/**
 * Live track state. `samples` is the closed centreline: each entry has
 * x, y, tangent (tx, ty), normal (nx, ny) and signed curvature (curv).
 * Replaced wholesale by loadTrackGeometry(); never mutated elsewhere.
 */
export const track = {
  seed: "",
  id: "",        // geometry hash — the localStorage key for ghosts and best times
  samples: [],
  length: 0,
  halfW: HALF_W,   // road half-width in px; a run's road mods scale it, loadTrackGeometry resets it
};

/** Rebuild the track from a seed string. `shape` (optional) is the generator's target — the run's ramp. */
export function loadTrackGeometry(seed, shape) {
  const rng = mulberry32(hashStr(seed));
  const built = buildTrack(rng, shape);
  track.seed = seed;
  track.samples = built.S;
  track.length = built.length;
  track.halfW = HALF_W;
  track.id = hashTrack(built.S);
  // Every geometry load — the daily track and each run stage — passes through
  // here, so this is the one announcement the music needs to follow the track.
  emit("geometry-loaded", { seed, id: track.id });
}

// Identify the track by its actual shape, so a ghost is only ever replayed on the
// track it was set on — different day, different layout, or a changed generator all
// produce a different id and simply have no ghost yet.
function hashTrack(S) {
  const N = S.length;
  let h = 2166136261;
  for (let i = 0; i < N; i += 17) {
    h ^= Math.round(S[i].x) | 0; h = Math.imul(h, 16777619);
    h ^= Math.round(S[i].y) | 0; h = Math.imul(h, 16777619);
  }
  h ^= N; h = Math.imul(h, 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Closest centreline segment to (px, py), searched within ±window samples of
 * `from` (the car can't teleport, so a local search is enough and stays O(1)).
 * Returns { i: sample index, t: fraction along segment i, dist: perpendicular distance }.
 *
 * The game uses the default window so a car far off the road still tracks
 * sensibly. For a car on the road the answer is identical for any window >= 2:
 * the road half-width (132px) is inside the tightest corner radius (185px), so
 * the nearest sample can only move by one per step there. The optimiser relies
 * on that to use a narrow window.
 */
export function nearest(px, py, from, window = 45) {
  const S = track.samples, N = S.length;
  let bi = from, bt = 0, bd = 1e18;
  for (let k = -window; k <= window; k++) {
    const i = ((from + k) % N + N) % N;
    const a = S[i], b = S[(i + 1) % N];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L2; t = clamp(t, 0, 1);
    const qx = a.x + dx * t, qy = a.y + dy * t;
    const d = (px - qx) ** 2 + (py - qy) ** 2;
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  return { i: bi, t: bt, dist: Math.sqrt(bd) };
}
