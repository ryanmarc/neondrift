// Entry point. Modules with side effects (event subscriptions, DOM wiring) are
// imported for those effects; the rest is explicit.

import { INITIAL_SEED } from "./config/params.js";
import { loadTrack, start, tick, run } from "./game/race.js";
import { resize } from "./render/renderer.js";
import { armAutoplay } from "./audio/context.js";
import { car, race } from "./game/state.js";
import { track } from "./track/track.js";
import { ghost } from "./game/ghost.js";
import { guides } from "./track/guides.js";
import { camera } from "./render/camera.js";
import { line, ensureLine } from "./sim/line.js";
import { run as runState } from "./run/state.js";
import { startRun, pick, restart as restartRun, abandon } from "./run/run.js";
import "./audio/sfx.js";       // subscribes to game events
import "./game/daily.js";     // rolls the daily track over at midnight UTC
import "./ui/hud.js";          // subscribes to game events
import "./ui/controls.js";     // wires the buttons
import "./net/leaderboard.js";  // subscribes to track-loaded and race-finish
import "./ui/board.js";         // the leaderboard panel

loadTrack(INITIAL_SEED);
resize();
armAutoplay();   // title-screen music as soon as the browser allows it
run();

// Poke at live state from the browser console: neon.car, neon.race, neon.track…
// neon.start(); neon.tick(t) in a loop drives a run with synthetic timestamps (hidden tab only).
window.neon = { car, race, track, ghost, guides, camera, line, loadTrack, start, tick, ensureLine,
  run: runState, startRun, pick, restartRun, abandon };
