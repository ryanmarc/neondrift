// The run's clock. Drains every physics step, refills only while the car is
// sliding on the road, and ends the run at zero. Pure functions over a run
// object and the flags integrate() returned — no wall clock anywhere, so a run
// is deterministic and replayable.

import { SLIDING, WENT_OFF, OFF_FREE } from "../game/dynamics.js";

export const TIMER = {
  start: 20,      // seconds on the clock at stage 1
  cap: 30,        // the most it can hold (× build.cap)
  drain: 1.0,     // seconds lost per second at stage 1 (× build.drain)
  drainMax: 1.75, // the early ramp approaches this multiple of `drain`, closing 15% of the gap
  rampK: 0.85,    // each stage (stage 5 ≈ 1.36, stage 9 ≈ 1.55): steep at first, then a knee —
  creep: 0.08,    // then it keeps climbing by this much per stage past `knee`, without bound.
  knee: 8,        // The knee is what keeps a single wall survivable; the creep is what makes
                  // every run end. A capped drain let a chain-keeping build refill forever.
  refill: 1.8,    // slide refill gain — see tickTimer for the formula
  bonus: 5,       // seconds for clearing a stage (× build.bonus)
  low: 5,         // "timer-low" fires crossing down through this; re-arms above low + 2
  skip: 4,        // what the Skip card pays (× build.skip)
  wind: 8,        // what a second wind sets the clock to
  lumpFloor: 1,   // a lump-sum card can leave this much, never less
};

export function drainRate(stage, build) {
  const ramp = 1 + (TIMER.drainMax - 1) * (1 - Math.pow(TIMER.rampK, stage - 1));
  const creep = TIMER.creep * Math.max(0, stage - (build.knee ?? TIMER.knee));
  return TIMER.drain * (ramp + creep) * build.drain;
}

export function capFor(build) {
  return TIMER.cap * build.cap;
}

/**
 * One physics step of the clock. Mutates run.timer and run.lowArmed.
 * The refill has the boost fill's shape: more angle, more speed, more chain →
 * more time. Returns { over, low, wind }: over once the clock is at zero (the
 * caller stops the session on the first), low on the step it first dips under
 * TIMER.low, wind on the step a Second wind turned a zero into TIMER.wind.
 */
export function tickTimer(run, flags, car, dt) {
  const b = run.build;
  let t = run.timer - dt * drainRate(run.stage, b);
  if ((flags & SLIDING) && car.mult >= b.refillFloorMult) {
    const speed = Math.hypot(car.vx, car.vy);
    t += dt * TIMER.refill * car.drift * Math.min(1, speed / b.T.maxSpeed) * car.mult * b.refill;
  }
  if ((flags & WENT_OFF) && !(flags & OFF_FREE) && b.offTax) t -= b.offTax;
  t = Math.min(t, capFor(b));

  let low = false;
  if (run.lowArmed && t <= TIMER.low) { low = true; run.lowArmed = false; }
  else if (!run.lowArmed && t > TIMER.low + 2) run.lowArmed = true;

  if (t <= 0) {
    // Second wind: once per life, zero becomes a small clock instead of the end.
    if ((run.livesUsed ?? 0) < (b.lives ?? 0)) {
      run.livesUsed = (run.livesUsed ?? 0) + 1; run.timer = TIMER.wind; run.lowArmed = true;
      return { over: false, low, wind: true };
    }
    run.timer = 0; return { over: true, low, wind: false };
  }
  run.timer = t;
  return { over: false, low, wind: false };
}

/** A pick-time payment (negative for a cost). Floored so a card can't end the run from the offer screen. */
export function addLump(run, seconds) {
  run.timer = Math.max(TIMER.lumpFloor, Math.min(capFor(run.build), run.timer + seconds));
}

/** Add seconds, capped. Used for the stage bonus and the Skip card. */
export function addBonus(run, seconds) {
  run.timer = Math.min(capFor(run.build), run.timer + seconds);
}
