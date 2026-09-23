// Race orchestration: loading a track, the countdown, the fixed-step loop, and
// the finish. This is the only module that ties physics, rendering, audio and
// HUD together per frame.

import { clamp } from "../core/math.js";
import { emit } from "../core/events.js";
import { LAPS, PHYSICS_DT, T_TICK, T_GO, T } from "../config/tuning.js";
import { track, loadTrackGeometry } from "../track/track.js";
import { rebuildGuides } from "../track/guides.js";
import { car, race, resetRace } from "./state.js";
import { loadGhost, commitRun } from "./ghost.js";
import { step } from "./physics.js";
import { camera, resetCamera } from "../render/camera.js";
import { draw } from "../render/renderer.js";
import * as SFX from "../audio/sfx.js";
import * as Music from "../audio/music.js";
import { updateHud, updateCountdown } from "../ui/hud.js";

let last = performance.now();
let acc = 0;   // physics accumulator (seconds of simulation owed)

/**
 * Build everything that depends on the seed and put the car on the line.
 * Called once at startup, and again whenever a new seed is entered, so the
 * track can change without a page reload.
 */
export function loadTrack(seed) {
  loadTrackGeometry(seed);
  rebuildGuides();
  loadGhost(track.id);
  resetRace(track.samples[0]);
  resetCamera(car, 0);
  emit("track-loaded");
}

/** Begin a run: reset, start the 3-2-1, and hand control to the loop. */
export function start() {
  resetRace(track.samples[0]);
  acc = 0; last = performance.now();
  race.countdown = 3 * T_TICK; race.goTimer = 0;
  emit("countdown", 3);
  resetCamera(car, camera.chase ? (-car.a - Math.PI / 2) : 0);
  race.running = true;
  emit("race-start");
}

function finish() {
  race.running = false; race.finished = true;
  emit("race-finish", commitRun(race.time, race.rec, race.inputs));
}

/**
 * What a session is: how many laps end it, a hook after every physics step
 * (return true to end it early), and what to do when it ends. The defaults are
 * the daily race. A run mode supplies its own via setRules() and hands back
 * null when it is done.
 */
export const defaultRules = {
  laps: LAPS,
  onStep(flags, dt) { return false; },
  onFinish(reason) { finish(); },
};
let rules = defaultRules;

/** Install a rules object, or null to restore the daily race (and the stock physics). */
export function setRules(r) {
  rules = r || defaultRules;
  if (!r) race.params = T;
}

/**
 * Advance the game by one frame. `now` is a DOMHighResTimeStamp (ms). Kept
 * separate from the requestAnimationFrame plumbing so a run can be driven
 * with synthetic timestamps — from tests, or a headless/replay harness.
 */
export function tick(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;

  if (race.running) {
    if (race.countdown > 0) {
      // hold the car on the line: no physics, no clock, no ghost playback yet
      const prevTick = Math.ceil(race.countdown / T_TICK);
      race.countdown = Math.max(0, race.countdown - dt);
      const nowTick = Math.ceil(race.countdown / T_TICK);
      if (nowTick !== prevTick && nowTick > 0) emit("countdown", nowTick);
      if (race.countdown === 0) { race.goTimer = T_GO; acc = 0; emit("countdown", 0); }
    } else {
      acc += dt;
      while (acc >= PHYSICS_DT) {
        const flags = step(PHYSICS_DT); acc -= PHYSICS_DT;
        if (rules.onStep(flags, PHYSICS_DT)) { rules.onFinish("stopped"); break; }
        if (car.lap > rules.laps) { rules.onFinish("laps"); break; }
      }
    }
  }
  if (race.goTimer > 0) race.goTimer = Math.max(0, race.goTimer - dt);

  updateCountdown();

  // step() stops on finish, so car.* freezes at its last value — feed silence
  // instead of stale numbers, which also covers the countdown and start screen
  const live = race.running && race.countdown <= 0;
  if (live) SFX.update(car.drift, Math.hypot(car.vx, car.vy), car.off, car.boosting);
  else SFX.update(0, 0, false, false);
  SFX.engineUpdate(live ? { speed: Math.hypot(car.vx, car.vy), boosting: car.boosting, drift: car.drift }
                        : { speed: 0, boosting: false, drift: 0 }, race.running, race.params, dt);
  Music.update(live, live && car.boosting);

  draw(dt, live ? clamp(acc / PHYSICS_DT, 0, 1) : 1);
  updateHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}

/** Start the animation loop. Call once. */
export function run() {
  last = performance.now();
  requestAnimationFrame(frame);
}
