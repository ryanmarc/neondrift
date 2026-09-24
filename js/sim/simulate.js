// Run a schedule through the real car dynamics on the loaded track and report
// the finishing time, how long the car spent off the road, and (optionally)
// where every press and release happened. Also provides the road-following
// controller that seeds the optimiser.

import { LAPS, PHYSICS_DT, T } from "../config/tuning.js";
import { track } from "../track/track.js";
import { createCar, placeCar, integrate } from "../game/dynamics.js";
import { createInput, normalize } from "./schedule.js";

// Narrow nearest-point window: identical to the game's for a car on the road
// (see nearest()), and roughly 5× faster. Off-road runs are rejected anyway.
const WINDOW = 6;

/**
 * @param schedule  see schedule.js
 * @param maxTime   give up after this many simulated seconds
 * @param trace     also record the input toggles (for markers)
 * @param laps      laps to finish (the daily race's by default)
 * @param P         physics table (T by default; a run's feel harness passes a build's)
 * @param start     optional (car) once it is on the line, to seed a state (a chain, a full meter)
 * @param observe   optional (car, inp, flags, time) after every step
 * @returns { time, off, finished, toggles? }
 */
export function simulate(schedule, { maxTime = 90, trace = false, laps = LAPS, P = T, start = null, observe = null } = {}) {
  const car = createCar();
  placeCar(car, track.samples[0]);
  if (start) start(car);
  const toggles = trace ? [] : null;
  const input = createInput(schedule);
  const steps = Math.ceil(maxTime / PHYSICS_DT);
  let time = 0, off = 0, prevInp = 0;
  for (let i = 0; i < steps; i++) {
    const prog = car.lap - 1 + car.prog;
    const inp = input(prog);
    if (trace && inp !== prevInp) {
      toggles.push({ P: prog, inp, lap: car.lap, idx: car.idx, x: car.x, y: car.y, a: car.a, t: time });
    }
    prevInp = inp;
    const flags = integrate(car, inp, PHYSICS_DT, WINDOW, P);
    time += PHYSICS_DT;
    if (observe) observe(car, inp, flags, time);
    if (car.off) off += PHYSICS_DT;
    if (car.lap > laps) return { time, off, finished: true, toggles };
  }
  return { time, off, finished: false, toggles };
}

/**
 * Drive the track with a short-horizon predictive controller: every `decide`
 * steps, try each input (left, none, right) held for `hold` steps and then
 * released, roll each forward through the real dynamics for `horizon` steps,
 * and commit to whichever stays closest to the centreline without leaving the
 * road. Records the taps it made as an open-loop schedule for the optimiser
 * to start from. Not fast, but safe and finishes. `laps`, `P` and `start`
 * default to the daily race's; the optimiser and the worker never pass them.
 * @returns { schedule, result, closedLoop }
 */
export function bootstrap({ decide = 6, hold = 12, horizon = 60, steerCost = 0.02, edge = 2, speed = 0, maxTime = 90, laps = LAPS, P = T, start = null } = {}) {
  const S = track.samples, N = S.length;
  const car = createCar();
  placeCar(car, S[0]);
  if (start) start(car);
  const probe = createCar();
  const segs = [];
  let open = null, inp = 0, time = 0, offT = 0, finished = false;

  // Cost of trying input u now: distance from the centreline over the horizon
  // (raised to `edge`, so a high power only minds the road edge), a large
  // penalty for leaving the road, and a reward for progress made when `speed`
  // is set — that is what lets it use the width of the road to go faster.
  // Each input is rolled out twice — released after `hold` steps, and held for
  // the whole horizon — and scored on the better of the two, so a corner that
  // needs a long sustained turn isn't misjudged by a rollout that lets go early.
  const rollout = (u, holdFor) => {
    Object.assign(probe, car);
    const P0 = probe.lap - 1 + probe.prog;
    let c = 0;
    for (let k = 0; k < horizon; k++) {
      integrate(probe, k < holdFor ? u : 0, PHYSICS_DT, WINDOW, P);
      const s = S[probe.idx], dx = probe.x - s.x, dy = probe.y - s.y;
      c += Math.pow((dx * dx + dy * dy) / (track.halfW * track.halfW), edge / 2) + (probe.off ? 100 : 0);
    }
    return c - speed * (probe.lap - 1 + probe.prog - P0);
  };
  const cost = (u) => (u === 0 ? rollout(0, 0) : Math.min(rollout(u, hold), rollout(u, horizon)) + steerCost);

  const steps = Math.ceil(maxTime / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    if (i % decide === 0) {
      let next = 0, bestC = cost(0);
      for (const u of [-1, 1]) { const c = cost(u); if (c < bestC) { bestC = c; next = u; } }
      if (next !== inp) {
        const prog = car.lap - 1 + car.prog;
        if (open) { open.b = prog; segs.push(open); open = null; }
        if (next !== 0) open = { a: prog, dir: next };
        inp = next;
      }
    }
    integrate(car, inp, PHYSICS_DT, WINDOW, P);
    time += PHYSICS_DT;
    if (car.off) offT += PHYSICS_DT;
    if (car.lap > laps) { finished = true; break; }
  }
  if (open) { open.b = laps; segs.push(open); }
  const schedule = normalize(segs);
  // The replay is open-loop, so re-measure it rather than trusting the closed-loop run.
  return { schedule, result: simulate(schedule, { laps, P, start }), closedLoop: { time, off: offT, finished } };
}
