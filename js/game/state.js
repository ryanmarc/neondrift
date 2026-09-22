// Mutable game state, grouped so every module reads and writes the same objects.
// Nothing here has behaviour; physics.js and race.js own the transitions.

import { createCar, placeCar } from "./dynamics.js";
import { T } from "../config/tuning.js";

/** The player's car. See dynamics.js for the fields. */
export const car = createCar();

/** One run: the clock, countdown, and the transient visual/recording buffers. */
export const race = {
  running: false,
  finished: false,
  time: 0,
  countdown: 0,     // seconds of 3-2-1 remaining; physics is frozen while > 0
  goTimer: 0,       // seconds the "GO" caption has left to fade
  params: T,        // the live physics table; a run swaps in its build's copy. resetRace leaves it alone
  marks: [],        // tire marks [{x, y, a, l}]
  trail: [],        // exhaust plume points [{x, y, l, hot}], dropped in world space
  trailAcc: 0,
  rec: [],          // ghost recording: flat [x, y, angle, progress, ...]
  recAcc: 0,
  inputs: [],       // [step, input, step, input, …] — every step the steering changed
  steps: 0,         // physics steps since GO; time = steps * PHYSICS_DT
  lastInput: 0,     // what was recorded last, so a change can be detected
  chainFlash: 0,
  shake: 0,
  breakT: 0,        // "×N LOST" readout timer
  lostMult: 1,
  keptMult: 1,      // what survived the break (a run keeps part of the chain)
};

/** Put the car on the start line and clear everything from the previous run. */
export function resetRace(startSample) {
  placeCar(car, startSample);
  race.time = 0; race.finished = false;
  race.marks = []; race.rec = []; race.recAcc = 0;
  race.inputs = []; race.steps = 0; race.lastInput = 0;
  race.chainFlash = 0; race.shake = 0; race.breakT = 0; race.lostMult = 1; race.keptMult = 1;
  race.trail = []; race.trailAcc = 0;
}
