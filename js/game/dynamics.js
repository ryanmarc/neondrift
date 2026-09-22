// The car model, pure. integrate() advances one car by one fixed step given a
// steering input and reports what happened as flag bits. No DOM, no audio, no
// randomness, no module-level game state — so the same code runs the live car,
// a Web Worker searching for the optimal line, and a Node harness.

import { clamp, lerp } from "../core/math.js";
import { T } from "../config/tuning.js";
import { track, nearest } from "../track/track.js";

/** Flag bits returned by integrate(). */
export const BOOST_IGNITED = 1;   // boost started this step
export const WENT_OFF = 2;        // crossed from on-track to off-track this step
export const SLIDING = 4;         // drifting on-track fast enough to fill boost

/** A fresh car. px/py/pa hold the previous pose for render interpolation. */
export function createCar() {
  return {
    x: 0, y: 0, a: 0, av: 0,       // position, heading, yaw rate
    vx: 0, vy: 0,                  // world-space velocity
    px: 0, py: 0, pa: 0,           // previous step's pose (draw() lerps between)
    idx: 0, prog: 0, lap: 1,       // nearest track sample, lap progress 0..1, lap number
    drift: 0, charge: 0, slipSm: 0,
    boost: 0, boosting: false, mult: 1,
    off: false,
  };
}

/** Put a car at rest on the start line (sample s, facing along its tangent). */
export function placeCar(car, s) {
  car.x = s.x; car.y = s.y; car.a = Math.atan2(s.ty, s.tx); car.av = 0;
  car.px = car.x; car.py = car.y; car.pa = car.a;
  car.vx = 0; car.vy = 0; car.idx = 0; car.prog = 0; car.lap = 1;
  car.drift = 0; car.charge = 0; car.boost = 0; car.boosting = false; car.mult = 1; car.slipSm = 0; car.off = false;
}

/**
 * Advance `car` by dt seconds with steering input inp (-1, 0, 1).
 * Uses the currently loaded track. Returns a bitmask of BOOST_IGNITED,
 * WENT_OFF and SLIDING. `window` is passed through to nearest(); see there.
 * `P` is the physics table, `T` unless a run mode supplies its own.
 */
export function integrate(car, inp, dt, window = 45, P = T) {
  let flags = 0;
  car.px = car.x; car.py = car.y; car.pa = car.a;   // previous state, for render interpolation

  if (inp !== 0) car.charge = Math.min(1, car.charge + dt / P.chargeUp);
  else car.charge = Math.max(0, car.charge - dt / P.chargeDown);

  const speed = Math.hypot(car.vx, car.vy);
  const turnScale = Math.min(1, speed / 175);

  // --- yaw: the nose has inertia, and it self-aligns toward the direction of travel
  {
    const hx0 = Math.cos(car.a), hy0 = Math.sin(car.a);
    const f0 = car.vx * hx0 + car.vy * hy0, l0 = car.vx * -hy0 + car.vy * hx0;
    const beta0 = Math.atan2(l0, Math.max(Math.abs(f0), 50));
    // Real tires don't restore harder the more sideways you get — the aligning force
    // peaks near the grip limit, then fades. That fade is what lets a drift hold.
    const ab = Math.abs(beta0), sn = Math.sin(ab);
    let shape = Math.max(sn * Math.exp(-ab / P.alignFall), sn * P.alignFloor) * Math.sign(beta0);
    shape *= 1 + Math.max(0, ab - 1.25) * 4;   // only gather it up once you're truly spinning
    // Second-order yaw: the aligning force is a TORQUE on a body with inertia, damped
    // separately — so the nose can swing slightly past straight and come back, which a
    // first-order system mathematically cannot do. om is derived from align and zeta so
    // the settled drift angle is unchanged; zeta alone controls the settling character.
    const w = (inp === 0 ? 0.90 : 0.50) * clamp(speed / 240, 0, 1);
    const om = 2 * P.zeta * P.align, damp = 2 * P.zeta * om;
    const yawAcc = om * om * shape * w - damp * car.av + inp * P.turn * turnScale * damp;
    car.av += yawAcc * dt;
    car.a += car.av * dt;
  }

  const hx = Math.cos(car.a), hy = Math.sin(car.a);
  let fwd = car.vx * hx + car.vy * hy;
  let lat = car.vx * -hy + car.vy * hx;

  // auto-boost on the straights
  // No threshold: any charge fires as soon as you stop steering. Small drifts give
  // small shoves, which is honest — and it means the meter never holds anything
  // you can't spend.
  const wasBoost = car.boosting;
  car.boosting = inp === 0 && car.boost > 0 && speed > 140;
  if (car.boosting && !wasBoost) flags |= BOOST_IGNITED;
  if (car.boosting) car.boost = Math.max(0, car.boost - P.boostDrain * dt);

  const top = (car.boosting ? P.boostSpeed : P.maxSpeed) * (car.off ? 0.52 : 1);
  const acc = car.boosting ? P.boostAccel : P.accel;
  fwd += acc * dt;
  if (fwd > top) fwd = lerp(fwd, top, 1 - Math.exp(-6 * dt));
  // sliding sideways scrubs speed — that's the cost of drifting
  fwd *= Math.exp(-((car.off ? P.offDrag : 0.30) + Math.abs(lat) / P.scrub) * dt);

  // --- friction circle: grip can only correct so much sideways motion per second.
  // Holding the turn breaks traction (lower ceiling); releasing restores the ceiling
  // but the slide already in the car still has to bleed off, so it persists.
  const latMax = lerp(P.gripMax, P.gripSlide, car.charge) * (car.off ? 0.45 : 1);
  const corr = Math.min(Math.abs(lat) * P.stiffness, latMax) * dt;
  lat -= Math.sign(lat) * Math.min(Math.abs(lat), corr);

  car.vx = hx * fwd + -hy * lat; car.vy = hy * fwd + hx * lat;

  // Tires scrub speed away faster than the engine can put it back, so losing speed
  // into a slide and regaining it on exit run on different clocks.
  const beta = Math.atan2(lat, Math.max(Math.abs(fwd), 50));
  const slipT = Math.abs(Math.sin(beta));
  const slipLag = slipT > car.slipSm ? P.slipLagIn : P.slipLagOut;
  car.slipSm += (slipT - car.slipSm) * (1 - Math.exp(-dt / slipLag));
  const cap = top * (1 - P.slipCost * car.slipSm);
  const tot = Math.hypot(car.vx, car.vy);
  if (tot > cap) { const k = cap / tot; car.vx *= k; car.vy *= k; }

  car.x += car.vx * dt; car.y += car.vy * dt;

  car.drift = Math.abs(beta);

  // track relationship. Progress is continuous (sample index plus the fraction
  // along that sample), so it advances every step the car moves forward — the
  // optimiser's schedules are keyed on it and need it to be strictly ordered.
  const N = track.samples.length;
  const near = nearest(car.x, car.y, car.idx, window);
  const prevP = car.prog;
  car.idx = near.i;
  const p = (near.i + near.t) / N;
  if (prevP > 0.86 && p < 0.14) car.lap++;
  else if (prevP < 0.14 && p > 0.86) car.lap--;
  car.prog = p;

  const wasOff = car.off;
  car.off = near.dist > track.halfW;
  if (car.off && !wasOff) {
    flags |= WENT_OFF;
    if (P.multResetOff) car.mult = 1;
  }

  // drifting fills boost
  const sliding = car.drift > P.driftMin && speed > 210 && !car.off;
  if (sliding) {
    flags |= SLIDING;
    car.boost = Math.min(P.boostCap, car.boost + dt * car.drift * (speed / P.maxSpeed) * P.boostFill * car.mult);
    car.mult = Math.min(P.multCap, car.mult + dt * P.multRise);
  } else if (!car.off) {
    car.mult = Math.max(1, car.mult - dt * P.multFall);
  }

  return flags;
}
