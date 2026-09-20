// Simulated annealing over input schedules. The objective is the finishing
// time, with a penalty per second spent off the road that dwarfs any possible
// time gain, so the search first gets the car onto the road and then makes it
// fast. An unfinished run is worse than any finished one.

import { simulate } from "./simulate.js";
import { mutate, normalize } from "./schedule.js";

export const OFF_PENALTY = 100;      // seconds of objective per second off-track
export const UNFINISHED_PENALTY = 200;

export function score(result) {
  return result.time + result.off * OFF_PENALTY + (result.finished ? 0 : UNFINISHED_PENALTY);
}

/**
 * @param initial     starting schedule
 * @param evals       number of simulations to run
 * @param rng         [0,1) random source (pass a seeded one for reproducibility)
 * @param onProgress  called every `report` evals with { evals, best, bestTime, feasible }
 * @returns { schedule, result, evals }
 */
export function optimize(initial, {
  evals = 3000, rng = Math.random, onProgress = null, report = 50,
  sigma0 = 0.02, sigma1 = 0.0015, temp0 = 0.3, temp1 = 0.005,
} = {}) {
  let cur = initial, curRes = simulate(cur), curScore = score(curRes);
  let best = cur, bestRes = curRes, bestScore = curScore;
  for (let i = 1; i <= evals; i++) {
    const f = i / evals;
    const sigma = sigma0 * Math.pow(sigma1 / sigma0, f);
    const temp = temp0 * Math.pow(temp1 / temp0, f);
    const cand = mutate(cur, rng, sigma);
    const res = simulate(cand), s = score(res);
    if (s <= curScore || rng() < Math.exp(-(s - curScore) / temp)) { cur = cand; curRes = res; curScore = s; }
    if (s < bestScore) { best = cand; bestRes = res; bestScore = s; }
    if (onProgress && i % report === 0) {
      onProgress({ evals: i, total: evals, best: bestScore, bestTime: bestRes.time, feasible: bestRes.off === 0 && bestRes.finished });
    }
  }
  return { schedule: best, result: bestRes, evals };
}

/**
 * Deterministic coordinate descent: for each step size in `deltas`, sweep every
 * segment endpoint, try moving it earlier and later by that amount, and keep
 * any move that lowers the score. Cheap, and it converges where annealing's
 * random nudges only wander.
 * @param onProgress  called after each sweep with { best, bestTime, feasible }
 */
export function polish(initial, { deltas = [0.004, 0.002, 0.001, 0.0005], onProgress = null } = {}) {
  let best = initial, bestRes = simulate(best), bestScore = score(bestRes), evals = 1;
  for (const d of deltas) {
    for (let i = 0; i < best.length; i++) {
      for (const key of ["a", "b"]) {
        for (const sign of [-1, 1]) {
          if (i >= best.length) break;          // an accepted move can merge segments away
          const cand = best.map(s => ({ ...s }));
          cand[i][key] += sign * d;
          const c = normalize(cand);
          const res = simulate(c), s = score(res); evals++;
          if (s < bestScore) { best = c; bestRes = res; bestScore = s; break; }
        }
      }
    }
    if (onProgress) onProgress({ best: bestScore, bestTime: bestRes.time, feasible: bestRes.off === 0 && bestRes.finished, evals });
  }
  return { schedule: best, result: bestRes, evals };
}
