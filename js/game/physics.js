// The live car's fixed-rate step: runs the pure dynamics on the player's car,
// then does everything that is only for show — tire marks, the exhaust plume,
// the ghost recording, the "×N LOST" readout — and emits events for audio/HUD.
// Called at PHYSICS_DT from the race loop.

import { clamp } from "../core/math.js";
import { emit } from "../core/events.js";
import { T, GHOST_HZ } from "../config/tuning.js";
import { steer } from "../input/input.js";
import { car, race } from "./state.js";
import { integrate, BOOST_IGNITED, WENT_OFF, SLIDING } from "./dynamics.js";

export function step(dt) {
  const speed = Math.hypot(car.vx, car.vy);   // entry speed, for the off-track cues
  const prevMult = car.mult;

  // The run is fully described by the steps where the input changed; the
  // leaderboard replays this list through the same integrate() to verify it.
  const inp = steer();
  if (inp !== race.lastInput) { race.inputs.push(race.steps, inp); race.lastInput = inp; }
  race.steps++;

  const flags = integrate(car, inp, dt);

  if (flags & BOOST_IGNITED) emit("boost");

  if (flags & WENT_OFF) {
    if (prevMult > 1.4) { race.lostMult = prevMult; race.breakT = 1; emit("chain-break"); }
    race.shake = Math.min(1, speed / 600); race.chainFlash = 0;
    emit("off-track", clamp(speed / T.maxSpeed, 0, 1));
  }

  if (flags & SLIDING) {
    if (race.marks.length < 1400 && Math.random() < 0.75) {
      race.marks.push({ x: car.x, y: car.y, a: car.a, l: 1 });
    }
    race.chainFlash = 1;
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
    race.rec.push(+car.x.toFixed(1), +car.y.toFixed(1), +car.a.toFixed(3), +(car.lap - 1 + car.prog).toFixed(4));
  }

  race.time += dt;
}
