// Chase camera. Follows where the car is TRAVELLING (not where the nose points),
// on a damped spring, with a smoothed look-ahead. Everything is framerate-
// independent: lags are 1-exp(-dt/tau), never a fixed per-frame lerp.

import { clamp, lerp, wrapAngle } from "../core/math.js";
import { T, CAM } from "../config/tuning.js";

export const camera = {
  x: 0, y: 0,       // world point at the view centre
  a: 0,             // view rotation
  z: 1,             // zoom (world px → screen px)
  av: 0,            // rotation velocity (the spring state)
  lx: 0, ly: 0,     // smoothed look-ahead offset
  chase: false,     // false = fixed orientation, true = rotate with travel
  spanScale: 1,     // a run's Wide angle pulls the view in; the run sets it, 1 otherwise
};

/** Snap the camera onto the car (race start, track load). */
export function resetCamera(car, angle) {
  camera.x = car.x; camera.y = car.y; camera.a = angle;
  camera.av = 0; camera.lx = 0; camera.ly = 0;
}

/**
 * Advance the camera one frame toward the car's interpolated pose (rx, ry, ra).
 * W/H is the viewport in CSS px; dt is the frame time in seconds.
 */
export function updateCamera(car, rx, ry, ra, W, H, dt) {
  // Show more of the world on a bigger viewport. Mapping a fixed world span to the
  // short edge made everything huge on desktop; the clamp leaves phones untouched.
  const vmin = Math.min(W, H);
  const span = (camera.chase ? CAM.spanChase : CAM.spanFixed) * clamp(vmin / 420, 1, 1.85) * camera.spanScale;
  // Zoom tracks actual speed on a slow lag, rather than stepping the moment boost
  // toggles — a binary flag made the view pop in and out at the ends of every boost.
  const sp = Math.hypot(car.vx, car.vy);
  const lo = T.maxSpeed * 0.55, hi = T.boostSpeed;
  const t = clamp((sp - lo) / (hi - lo), 0, 1);
  const targetZ = vmin / span * (1 - T.zoomRange * t);
  camera.z += (targetZ - camera.z) * (1 - Math.exp(-dt / T.zoomLag));

  const lead = camera.chase ? CAM.leadChase : CAM.leadFixed;
  // The look-ahead is velocity * lead, and velocity swings hard the moment a slide
  // starts — which yanked the camera's aim point backwards and made the pan stall
  // on every tap. Smooth the look-ahead vector itself so the target moves evenly.
  const lk = 1 - Math.exp(-dt / CAM.leadLag);
  camera.lx += (car.vx * lead - camera.lx) * lk;
  camera.ly += (car.vy * lead - camera.ly) * lk;
  const tx = rx + camera.lx, ty = ry + camera.ly;
  const fk = 1 - Math.exp(-dt / CAM.followLag);
  camera.x = lerp(camera.x, tx, fk); camera.y = lerp(camera.y, ty, fk);

  // Aimed mostly at the direction of travel so a drift doesn't whip the view
  // around. Held by a spring, so it trails and settles rather than being welded
  // to the car.
  let target = 0;
  if (camera.chase) {
    const travel = sp > 60 ? Math.atan2(car.vy, car.vx) : ra;
    const nose = wrapAngle(ra - travel);
    target = -(travel + nose * CAM.face) - Math.PI / 2;
  }
  const err = wrapAngle(target - camera.a);
  const cdt = Math.min(dt, 1 / 30);
  camera.av += (CAM.freq * CAM.freq * err - 2 * CAM.zeta * CAM.freq * camera.av) * cdt;
  camera.a += camera.av * cdt;
}
