// Mutable game state, grouped so every module reads and writes the same objects.
// Nothing here has behaviour; physics.js and race.js own the transitions.

/** The player's car. px/py/pa hold the previous physics pose for render interpolation. */
export const car = {
  x: 0, y: 0, a: 0, av: 0,       // position, heading, yaw rate
  vx: 0, vy: 0,                  // world-space velocity
  px: 0, py: 0, pa: 0,           // previous step's pose (draw() lerps between)
  idx: 0, prog: 0, lap: 1,       // nearest track sample, lap progress 0..1, lap number
  drift: 0, charge: 0, slipSm: 0,
  boost: 0, boosting: false, mult: 1,
  off: false,
};

/** One run: the clock, countdown, and the transient visual/recording buffers. */
export const race = {
  running: false,
  finished: false,
  time: 0,
  countdown: 0,     // seconds of 3-2-1 remaining; physics is frozen while > 0
  goTimer: 0,       // seconds the "GO" caption has left to fade
  marks: [],        // tire marks [{x, y, a, l}]
  trail: [],        // exhaust plume points [{x, y, l, hot}], dropped in world space
  trailAcc: 0,
  rec: [],          // ghost recording: flat [x, y, angle, progress, ...]
  recAcc: 0,
  chainFlash: 0,
  shake: 0,
  breakT: 0,        // "×N LOST" readout timer
  lostMult: 1,
};

/** Put the car on the start line and clear everything from the previous run. */
export function resetRace(startSample) {
  const s = startSample;
  car.x = s.x; car.y = s.y; car.a = Math.atan2(s.ty, s.tx); car.av = 0;
  car.px = car.x; car.py = car.y; car.pa = car.a;
  car.vx = 0; car.vy = 0; car.idx = 0; car.prog = 0; car.lap = 1;
  car.drift = 0; car.charge = 0; car.boost = 0; car.boosting = false; car.mult = 1; car.slipSm = 0; car.off = false;
  race.time = 0; race.finished = false;
  race.marks = []; race.rec = []; race.recAcc = 0;
  race.chainFlash = 0; race.shake = 0; race.breakT = 0; race.lostMult = 1;
  race.trail = []; race.trailAcc = 0;
}
