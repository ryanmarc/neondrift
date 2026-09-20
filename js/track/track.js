// The current track: its samples, its identity, and geometry queries against it.

import { clamp } from "../core/math.js";
import { mulberry32, hashStr } from "../core/random.js";
import { buildTrack } from "./generator.js";

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
};

/** Rebuild the track from a seed string. */
export function loadTrackGeometry(seed) {
  const rng = mulberry32(hashStr(seed));
  const built = buildTrack(rng);
  track.seed = seed;
  track.samples = built.S;
  track.length = built.length;
  track.id = hashTrack(built.S);
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
 * Closest centreline segment to (px, py), searched within ±45 samples of `from`
 * (the car can't teleport, so a local search is enough and stays O(1)).
 * Returns { i: sample index, dist: perpendicular distance }.
 */
export function nearest(px, py, from) {
  const S = track.samples, N = S.length;
  let bi = from, bd = 1e18;
  for (let k = -45; k <= 45; k++) {
    const i = ((from + k) % N + N) % N;
    const a = S[i], b = S[(i + 1) % N];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L2; t = clamp(t, 0, 1);
    const qx = a.x + dx * t, qy = a.y + dy * t;
    const d = (px - qx) ** 2 + (py - qy) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return { i: bi, dist: Math.sqrt(bd) };
}
