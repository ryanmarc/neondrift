// The cockpit camera: where the driver's head points, how wide the view is, how
// far the drawn car bends to keep its cluster on screen, and the sideways force
// the cabin rolls with. The counterpart of camera.js for the cockpit mode; the
// renderer calls updateHead() once a frame and cockpit.js/interior.js read `head`.
//
// The view turns freely: it follows a point on the road ahead (not the velocity,
// which only reacts) on a lag, and never the car's own rotation, so a spinning
// car doesn't spin the view. When the head turns past the angle where the dash
// cluster would leave the screen, the whole car is drawn bent back toward the
// view — one rigid body — instead of the view being limited. (Limiting the view
// locked it to the car's spin in exactly the slides that matter.)

import { clamp, wrapAngle } from "../core/math.js";
import { STEP, COCKPIT } from "../config/tuning.js";

export const WHEEL_R = 0.26;   // wheel radius as a fraction of min(W, H): the interior's layout unit

export const head = {
  h: 0,          // view heading (rad)
  g: 0,          // smoothed sideways force, units of COCKPIT.gRef, + = toward the car's right
  pvx: 0, pvy: 0,
  fov: COCKPIT.fov,
  wheel: 0,      // steering wheel rotation (rad)
  // derived each frame
  ex: 0, ey: 0, focal: 1, hy: 0, wr: 1, dMax: 0.5, carA: 0,
};

/** Heading from the eye to the centreline point max(lookMin, speed × lookT) ahead. */
export function lookAngle(samples, idx, speed, ex, ey, P = COCKPIT) {
  const dist = Math.max(P.lookMin, speed * P.lookT);
  const s = samples[(idx + Math.round(dist / STEP)) % samples.length];
  return Math.atan2(s.y - ey, s.x - ex);
}

/** yaw of the way from the nose to the look point, capped at lookMax. */
export function headTarget(ra, look, P = COCKPIT) {
  const lim = P.lookMax * Math.PI / 180;
  return ra + clamp(wrapAngle(look - ra) * P.yaw, -lim, lim);
}

/** The car's drawn heading: its true one, eased (tanh) to within dMax of the view. */
export function carAngle(h, ra, dMax) {
  return h - dMax * Math.tanh(wrapAngle(h - ra) / dMax);
}

export function focalFor(W, fovDeg) {
  return (W / 2) / Math.tan(fovDeg * Math.PI / 360);
}

export function horizonFor(W, H, P = COCKPIT) {
  return H * (W >= H ? P.horizon : P.horizonPortrait);
}

/** The largest head turn off the drawn car that keeps the cluster's centre 0.7
 *  wheel radii inside the screen edge. */
export function bendLimit(W, H, focal) {
  const wr = Math.min(W, H) * WHEEL_R;
  return Math.atan(Math.max(0.05, W / 2 - wr * 0.7) / focal);
}

export function updateHead(car, { samples, running, rx, ry, ra, W, H, dt, spanScale, input }) {
  const P = COCKPIT;
  head.ex = rx - Math.sin(ra) * P.seat;
  head.ey = ry + Math.cos(ra) * P.seat;

  const sp = Math.hypot(car.vx, car.vy);
  const target = headTarget(ra, lookAngle(samples, car.idx, sp, head.ex, head.ey, P), P);
  if (sp < 5 || !running) head.h = target;       // parked, the countdown, a restart: no swing in
  else head.h += wrapAngle(target - head.h) * (1 - Math.exp(-dt / P.yawLag));

  const fovT = (P.fov + (car.boosting ? P.boostFov : 0)) * spanScale;   // Wide angle's cost: a narrower view
  head.fov += (fovT - head.fov) * (1 - Math.exp(-dt / 0.35));
  head.focal = focalFor(W, head.fov);
  head.hy = horizonFor(W, H, P);
  head.wr = Math.min(W, H) * WHEEL_R;
  head.dMax = bendLimit(W, H, head.focal);
  head.carA = carAngle(head.h, ra, head.dMax);

  // sideways acceleration in the car's own frame, for body roll
  if (dt > 0 && running) {
    const ax = (car.vx - head.pvx) / dt, ay = (car.vy - head.pvy) / dt;
    const lat = (ax * -Math.sin(ra) + ay * Math.cos(ra)) / P.gRef;
    head.g += (clamp(lat, -2, 2) - head.g) * (1 - Math.exp(-dt / P.gLag));
  } else head.g = 0;
  head.pvx = car.vx; head.pvy = car.vy;

  head.wheel += (input * 1.6 - head.wheel) * (1 - Math.exp(-dt / 0.07));
}
