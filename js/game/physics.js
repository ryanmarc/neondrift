// The fixed-rate physics step. Called at PHYSICS_DT from the race loop; never
// touches the DOM or audio directly — it emits events for those.

import { clamp, lerp } from "../core/math.js";
import { emit } from "../core/events.js";
import { T, HALF_W, GHOST_HZ } from "../config/tuning.js";
import { track, nearest } from "../track/track.js";
import { steer } from "../input/input.js";
import { car, race } from "./state.js";

export function step(dt) {
  car.px = car.x; car.py = car.y; car.pa = car.a;   // previous state, for render interpolation
  const inp = steer();

  if (inp !== 0) car.charge = Math.min(1, car.charge + dt / T.chargeUp);
  else car.charge = Math.max(0, car.charge - dt / T.chargeDown);

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
    let shape = Math.max(sn * Math.exp(-ab / T.alignFall), sn * T.alignFloor) * Math.sign(beta0);
    shape *= 1 + Math.max(0, ab - 1.25) * 4;   // only gather it up once you're truly spinning
    // Second-order yaw: the aligning force is a TORQUE on a body with inertia, damped
    // separately — so the nose can swing slightly past straight and come back, which a
    // first-order system mathematically cannot do. om is derived from align and zeta so
    // the settled drift angle is unchanged; zeta alone controls the settling character.
    const w = (inp === 0 ? 0.90 : 0.50) * clamp(speed / 240, 0, 1);
    const om = 2 * T.zeta * T.align, damp = 2 * T.zeta * om;
    const yawAcc = om * om * shape * w - damp * car.av + inp * T.turn * turnScale * damp;
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
  if (car.boosting && !wasBoost) emit("boost");
  if (car.boosting) car.boost = Math.max(0, car.boost - T.boostDrain * dt);

  const top = (car.boosting ? T.boostSpeed : T.maxSpeed) * (car.off ? 0.52 : 1);
  const acc = car.boosting ? T.boostAccel : T.accel;
  fwd += acc * dt;
  if (fwd > top) fwd = lerp(fwd, top, 1 - Math.exp(-6 * dt));
  // sliding sideways scrubs speed — that's the cost of drifting
  fwd *= Math.exp(-((car.off ? T.offDrag : 0.30) + Math.abs(lat) / T.scrub) * dt);

  // --- friction circle: grip can only correct so much sideways motion per second.
  // Holding the turn breaks traction (lower ceiling); releasing restores the ceiling
  // but the slide already in the car still has to bleed off, so it persists.
  const latMax = lerp(T.gripMax, T.gripSlide, car.charge) * (car.off ? 0.45 : 1);
  const corr = Math.min(Math.abs(lat) * T.stiffness, latMax) * dt;
  lat -= Math.sign(lat) * Math.min(Math.abs(lat), corr);

  car.vx = hx * fwd + -hy * lat; car.vy = hy * fwd + hx * lat;

  // Tires scrub speed away faster than the engine can put it back, so losing speed
  // into a slide and regaining it on exit run on different clocks.
  const beta = Math.atan2(lat, Math.max(Math.abs(fwd), 50));
  const slipT = Math.abs(Math.sin(beta));
  const slipLag = slipT > car.slipSm ? T.slipLagIn : T.slipLagOut;
  car.slipSm += (slipT - car.slipSm) * (1 - Math.exp(-dt / slipLag));
  const cap = top * (1 - T.slipCost * car.slipSm);
  const tot = Math.hypot(car.vx, car.vy);
  if (tot > cap) { const k = cap / tot; car.vx *= k; car.vy *= k; }

  car.x += car.vx * dt; car.y += car.vy * dt;

  car.drift = Math.abs(beta);

  // track relationship
  const N = track.samples.length;
  const near = nearest(car.x, car.y, car.idx);
  const prevP = car.idx / N;
  car.idx = near.i;
  const p = car.idx / N;
  if (prevP > 0.86 && p < 0.14) car.lap++;
  else if (prevP < 0.14 && p > 0.86) car.lap--;
  car.prog = p;

  const wasOff = car.off;
  car.off = near.dist > HALF_W;
  if (car.off && !wasOff) {
    if (car.mult > 1.4) { race.lostMult = car.mult; race.breakT = 1; emit("chain-break"); }
    car.mult = 1; race.shake = Math.min(1, speed / 600); race.chainFlash = 0;
    emit("off-track", clamp(speed / T.maxSpeed, 0, 1));
  }

  // drifting fills boost
  const sliding = car.drift > T.driftMin && speed > 210 && !car.off;
  if (sliding) {
    car.boost = Math.min(T.boostCap, car.boost + dt * car.drift * (speed / T.maxSpeed) * T.boostFill * car.mult);
    car.mult = Math.min(4, car.mult + dt * 0.30);
    if (race.marks.length < 1400 && Math.random() < 0.75) {
      race.marks.push({ x: car.x, y: car.y, a: car.a, l: 1 });
    }
    race.chainFlash = 1;
  } else if (!car.off) {
    car.mult = Math.max(1, car.mult - dt * 0.10);
  }

  // Exhaust is dropped in world space at the tailpipe and left there, so the plume
  // bends with the car's path instead of pointing wherever the nose happens to face.
  race.trailAcc += dt;
  if (race.trailAcc >= 1 / 70) {
    race.trailAcc -= 1 / 70;
    const th = Math.cos(car.a), tv = Math.sin(car.a);
    race.trail.push({ x: car.x - th * 15, y: car.y - tv * 15, l: 1, hot: car.boosting ? 1 : 0 });
    if (race.trail.length > 34) race.trail.shift();
  }
  for (const pt of race.trail) pt.l -= dt * 3.2;
  while (race.trail.length && race.trail[0].l <= 0) race.trail.shift();

  const marks = race.marks;
  for (let i = marks.length - 1; i >= 0; i--) { marks[i].l -= dt * 0.055; if (marks[i].l <= 0) marks.splice(i, 1); }
  race.shake = Math.max(0, race.shake - dt * 2.5);
  race.chainFlash = Math.max(0, race.chainFlash - dt * 1.8);
  race.breakT = Math.max(0, race.breakT - dt * 1.1);

  // ghost recording
  race.recAcc += dt;
  if (race.recAcc >= 1 / GHOST_HZ) {
    race.recAcc -= 1 / GHOST_HZ;
    race.rec.push(+car.x.toFixed(1), +car.y.toFixed(1), +car.a.toFixed(3), +(car.lap - 1 + p).toFixed(4));
  }

  race.time += dt;
}
