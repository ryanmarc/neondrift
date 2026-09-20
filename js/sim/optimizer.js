// The whole pipeline for one track: seed candidate lines with the predictive
// controller, keep the best one that stays on the road, then refine it with
// annealing and coordinate descent. Runs anywhere the dynamics run — the Web
// Worker in the game, or Node for benchmarks.

import { mulberry32, hashStr } from "../core/random.js";
import { track } from "../track/track.js";
import { bootstrap, simulate } from "./simulate.js";
import { optimize, polish, score } from "./search.js";

/** Bumped whenever the search or its inputs change, so cached lines are recomputed. */
export const LINE_VERSION = 1;

// Controller settings tried for the starting line: [edge, speed, hold].
const VARIANTS = [[2, 0, 12], [4, 60, 12], [4, 120, 12], [6, 60, 12], [4, 60, 18], [6, 120, 18]];
const HORIZONS = [120, 100];

/**
 * @param evals       annealing budget (simulations)
 * @param onProgress  ({ stage, bestTime, feasible, fraction }) as the search runs
 * @returns { schedule, time, off, feasible, toggles }
 */
export function findLine({ evals = 1000, onProgress = null } = {}) {
  const report = (stage, res, fraction) => onProgress && onProgress({
    stage, bestTime: res.time, feasible: res.off === 0 && res.finished, fraction,
  });

  // 1. candidate lines from the controller; best feasible wins, else best score
  let best = null, done = 0;
  for (const horizon of HORIZONS) for (const [edge, speed, hold] of VARIANTS) {
    const b = bootstrap({ hold, horizon, edge, speed });
    const s = score(b.result);
    if (!best || s < best.s) best = { s, schedule: b.schedule, result: b.result };
    report("bootstrap", best.result, ++done / (HORIZONS.length * VARIANTS.length) * 0.2);
  }

  // 2. anneal (seeded per track so the result is reproducible)
  const rng = mulberry32(hashStr(track.id + ":line"));
  const annealed = optimize(best.schedule, {
    evals, rng, sigma0: 0.006, sigma1: 0.0008, temp0: 0.2, temp1: 0.003, report: 100,
    onProgress: p => onProgress && onProgress({ stage: "anneal", bestTime: p.bestTime, feasible: p.feasible, fraction: 0.2 + 0.5 * p.evals / p.total }),
  });

  // 3. polish
  const polished = polish(annealed.schedule, {
    deltas: [0.003, 0.0015, 0.0007],
    onProgress: p => onProgress && onProgress({ stage: "polish", bestTime: p.bestTime, feasible: p.feasible, fraction: 0.9 }),
  });

  const final = simulate(polished.schedule, { trace: true });
  report("done", final, 1);
  return {
    schedule: polished.schedule,
    time: final.time, off: final.off,
    feasible: final.off === 0 && final.finished,
    toggles: final.toggles,
  };
}
