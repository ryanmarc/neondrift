// Every hand-tuned number in one place. See CLAUDE.md for what each knob does.

// ---------- race ----------
export const LAPS = 3;
export const PHYSICS_DT = 1 / 120;   // fixed physics step; rendering interpolates
export const GHOST_HZ = 30;          // ghost recording / playback rate
export const T_TICK = 0.6;           // 3-2-1 at 0.6s each…
export const T_GO = 0.45;            // …then GO fades over 0.45s

// ---------- track ----------
export const ROAD_W = 264;
export const HALF_W = ROAD_W / 2;
export const STEP = 12;              // spacing of centreline samples (px)

// ---------- car physics ----------
export const T = {
  accel: 1040, maxSpeed: 690, boostSpeed: 945, boostAccel: 1560,
  turn: 3.15, zeta: 0.45,       // steering rate, and yaw damping ratio (lower = more overshoot)
  align: 11,                    // self-aligning torque gain
  alignFall: 0.75,              // slip angle (rad) past which the restoring force fades
  alignFloor: 0.40,             // how much restoring force survives at big angles
  stiffness: 13,                // lateral correction rate while the tires still bite
  gripMax: 1150,                // max lateral accel with grip (px/s^2)
  gripSlide: 260,               // max lateral accel once traction breaks
  chargeUp: 0.24, chargeDown: 0.45,
  driftMin: 0.13, scrub: 1000, slipCost: 0.26,
  slipLagIn: 0.22,              // seconds to bleed speed off as a slide builds
  slipLagOut: 0.45,             // seconds to gather it back up as the car straightens
  boostCap: 1.0, boostDrain: 0.46, boostFill: 0.60,
  offDrag: 2.2,
  zoomRange: 0.045,             // how far the view pulls back at full speed
  zoomLag: 0.60,                // seconds for the zoom to follow a speed change
};

// ---------- camera ----------
// face: 0 = follow direction of travel only, 1 = follow the nose.
// freq: how stiff the chase spring is (lower = looser, laggier). zeta: damping —
// below 1 the camera overshoots slightly and swings back, which is the elasticity.
export const CAM = {
  face: 0.12, freq: 3.8, zeta: 0.80,
  leadLag: 0.35,                // smooths the look-ahead vector (see updateCamera)
  followLag: 0.11,              // seconds for the position to catch up to its target
  spanFixed: 1080, spanChase: 980,   // world px across the short viewport edge
  leadFixed: 0.36, leadChase: 0.30,  // look-ahead, in seconds of velocity
};

// ---------- drift guides ----------
// Heuristic, not a solved optimum. Corners come from the track's own curvature.
// The lead/trail distances come from the car's measured response: a slide takes
// about chargeUp+yaw time to build, and about slipLagOut to gather back up, so
// you commit before the corner starts and release before it ends.
export const GUIDE = { minRadius: 520, lead: 0.34, trail: 0.42, minCorner: 120 };
