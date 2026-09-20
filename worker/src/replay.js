// Replays a submitted run through the game's own dynamics. The track is
// rebuilt from the seed (and cached per isolate), the recorded input changes
// are applied step for step, and the time this produces is the one that
// counts. Everything imported here is DOM-free.

import { loadTrackGeometry, track } from "../../js/track/track.js";
import { createCar, placeCar, integrate } from "../../js/game/dynamics.js";
import { PHYSICS_DT, LAPS, GHOST_HZ } from "../../js/config/tuning.js";

export const MAX_SECONDS = 75;        // replay cap, keeps a request inside the CPU budget
export const TIME_TOLERANCE = 0.05;   // seconds between replayed and claimed time
export const PATH_TOLERANCE = 24;     // px between replayed and submitted ghost positions

const cache = new Map();

/** Build (or fetch from cache) the track for a seed and make it the current one. */
export function trackFor(seed) {
  let t = cache.get(seed);
  if (!t) {
    loadTrackGeometry(seed);
    t = { id: track.id, samples: track.samples, length: track.length };
    cache.set(seed, t);
  }
  track.seed = seed; track.id = t.id; track.samples = t.samples; track.length = t.length;
  return t;
}

/**
 * @param seed         track seed
 * @param inputs       flat [step, input, …] of input changes
 * @param ghost        the client's 30Hz [x, y, a, progress, …] recording (may be empty)
 * @param claimedTime  the client's finishing time
 * @returns { ok, time, reason?, maxDeviation }
 */
export function replay(seed, inputs, { ghost = [], claimedTime = null } = {}) {
  trackFor(seed);
  const car = createCar();
  placeCar(car, track.samples[0]);
  const maxSteps = Math.ceil(MAX_SECONDS / PHYSICS_DT);
  let ptr = 0, inp = 0, time = 0, recAcc = 0, frame = 0, maxDeviation = 0;
  for (let i = 0; i < maxSteps; i++) {
    while (ptr < inputs.length && inputs[ptr] === i) { inp = inputs[ptr + 1]; ptr += 2; }
    integrate(car, inp, PHYSICS_DT);          // the game's default nearest-point window
    time += PHYSICS_DT;
    // mirror the game's ghost recorder so frames line up
    recAcc += PHYSICS_DT;
    if (recAcc >= 1 / GHOST_HZ) {
      recAcc -= 1 / GHOST_HZ;
      const o = frame * 4;
      if (o + 1 < ghost.length) {
        const d = Math.hypot(car.x - ghost[o], car.y - ghost[o + 1]);
        if (d > maxDeviation) maxDeviation = d;
        if (d > PATH_TOLERANCE) return { ok: false, time, reason: "path-mismatch", maxDeviation };
      }
      frame++;
    }
    if (car.lap > LAPS) {
      if (claimedTime != null && Math.abs(time - claimedTime) > TIME_TOLERANCE) {
        return { ok: false, time, reason: "time-mismatch", maxDeviation };
      }
      return { ok: true, time, maxDeviation };
    }
  }
  return { ok: false, time, reason: "unfinished", maxDeviation };
}
