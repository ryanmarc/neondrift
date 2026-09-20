// Drift guide markers: where to commit to a slide and where to release.
// Behind a feature flag (GUIDES_FLAG); drawn by the renderer when `visible`.

import { GUIDES_FLAG } from "../config/params.js";
import { GUIDE, STEP, T } from "../config/tuning.js";
import { track } from "./track.js";

export const guides = {
  flag: GUIDES_FLAG,      // are guides available at all (shows the toggle button)
  visible: GUIDES_FLAG,   // are they currently drawn
  list: [],               // [{ a: entry sample, b: exit sample, dir: ±1 }]
};

/** Recompute the guide list for the current track. */
export function rebuildGuides() {
  guides.list = buildGuides(track.samples);
}

/** Heuristic corner detection on a sample array. Pure; also used to seed the optimiser. */
export function buildGuides(S) {
  const N = S.length;
  const cur = new Float32Array(N);
  for (let i = 0; i < N; i++) {                    // smooth out sampling noise
    let s = 0; for (let k = -8; k <= 8; k++) s += S[((i + k) % N + N) % N].curv;
    cur[i] = s / 17;
  }
  const thr = STEP / GUIDE.minRadius;              // curvature of the tightest free-flowing corner
  const cruise = T.maxSpeed * 0.85;
  const leadN = Math.round(cruise * GUIDE.lead / STEP);
  const trailN = Math.round(cruise * GUIDE.trail / STEP);
  const out = []; let i = 0;
  while (i < N) {
    if (Math.abs(cur[i]) > thr) {
      const sign = Math.sign(cur[i]); let j = i;
      while (j - i < N && Math.abs(cur[j % N]) > thr * 0.5 && Math.sign(cur[j % N]) === sign) j++;
      if ((j - i) * STEP > GUIDE.minCorner) {
        out.push({ a: ((i - leadN) % N + N) % N, b: ((j - trailN) % N + N) % N, dir: sign });
      }
      i = j;
    } else i++;
  }
  return out;
}
