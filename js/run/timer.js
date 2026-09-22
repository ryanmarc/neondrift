// The run's clock. Drains every physics step, refills only while the car is
// sliding on the road, and ends the run at zero. Pure functions over a run
// object and the flags integrate() returned — no wall clock anywhere, so a run
// is deterministic and replayable.

import { SLIDING, WENT_OFF } from "../game/dynamics.js";

export const TIMER = {
  start: 20,      // seconds on the clock at stage 1
  cap: 30,        // the most it can hold (× build.cap)
  drain: 1.0,     // seconds lost per second at stage 1 (× build.drain)
  drainMax: 1.75, // the drain approaches this multiple of `drain` and never reaches it —
  rampK: 0.85,    // closing this much less of the gap each stage (stage 5 ≈ 1.36, stage 9 ≈ 1.55, stage 15 ≈ 1.67).
                  // A ceiling keeps a late run hard but never impossible: a ×3 chain still breaks even.
  refill: 1.8,    // slide refill gain — see tickTimer for the formula
  bonus: 5,       // seconds for clearing a stage (× build.bonus)
  low: 5,         // "timer-low" fires crossing down through this; re-arms above low + 2
  skip: 4,        // what the Skip card pays
};

export function drainRate(stage, build) {
  const ramp = 1 + (TIMER.drainMax - 1) * (1 - Math.pow(TIMER.rampK, stage - 1));
  return TIMER.drain * ramp * build.drain;
}

export function capFor(build) {
  return TIMER.cap * build.cap;
}

/**
 * One physics step of the clock. Mutates run.timer and run.lowArmed.
 * The refill has the boost fill's shape: more angle, more speed, more chain →
 * more time. Returns { over, low }: over once the clock is at zero (the caller
 * stops the session on the first), low on the step it first dips under TIMER.low.
 */
export function tickTimer(run, flags, car, dt) {
  const b = run.build;
  let t = run.timer - dt * drainRate(run.stage, b);
  if ((flags & SLIDING) && car.mult >= b.refillFloorMult) {
    const speed = Math.hypot(car.vx, car.vy);
    t += dt * TIMER.refill * car.drift * Math.min(1, speed / b.T.maxSpeed) * car.mult * b.refill;
  }
  if ((flags & WENT_OFF) && b.offTax) t -= b.offTax;
  t = Math.min(t, capFor(b));

  let low = false;
  if (run.lowArmed && t <= TIMER.low) { low = true; run.lowArmed = false; }
  else if (!run.lowArmed && t > TIMER.low + 2) run.lowArmed = true;

  if (t <= 0) { run.timer = 0; return { over: true, low }; }
  run.timer = t;
  return { over: false, low };
}

/** Add seconds, capped. Used for the stage bonus and the Skip card. */
export function addBonus(run, seconds) {
  run.timer = Math.min(capFor(run.build), run.timer + seconds);
}
