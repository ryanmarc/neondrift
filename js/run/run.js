// A run: stages in sequence, the clock, the picks. This is the only module
// that drives the race loop for the run mode, and it does so only through
// setRules(), start(), startStage() and events. No DOM, no audio: the UI
// listens.

import { emit } from "../core/events.js";
import * as storage from "../core/storage.js";
import { todayUtc } from "../config/params.js";
import { HALF_W } from "../config/tuning.js";
import { track, loadTrackGeometry } from "../track/track.js";
import { guides } from "../track/guides.js";
import { car, race, resetRace } from "../game/state.js";
import { loadTrack, start, startStage, setRules } from "../game/race.js";
import { camera, resetCamera } from "../render/camera.js";
import { run } from "./state.js";
import { buildFrom, canPick, SKIP } from "./mods.js";
import { offerFor } from "./offer.js";
import { TIMER, tickTimer, addBonus } from "./timer.js";
import { stageSeed, beats, parseBest, bestKeyDay, BEST_KEY_ALL } from "./stages.js";

let savedGuides = false;

/** Read the stored bests for a day into run.bestDay / run.bestAll. Safe with nothing stored. */
export function loadBests(day) {
  run.bestDay = parseBest(storage.read(bestKeyDay(day)));
  run.bestAll = parseBest(storage.read(BEST_KEY_ALL));
}

// Build stage n's track and put the car on its line. Deliberately not
// loadTrack(): no ghost, no guides, no track-loaded event, so the leaderboard
// never fetches a board for a stage and the HUD never rewrites the URL.
function loadStage(n) {
  loadTrackGeometry(stageSeed(run.day, n));
  track.halfW = HALF_W * run.build.halfW;
  resetRace(track.samples[0]);
  race.params = run.build.T;
  resetCamera(car, camera.chase ? (-car.a - Math.PI / 2) : 0);
  run.stage = n;
  run.stages.push({ seed: track.seed, id: track.id, inputs: null, time: null, prog: 0 });
}

const runRules = {
  laps: 1,
  onStep(flags, dt) {
    const r = tickTimer(run, flags, car, dt);
    if (r.low) emit("timer-low");
    return r.over;
  },
  onFinish(reason) {
    race.running = false;
    const cur = run.stages[run.stages.length - 1];
    cur.inputs = race.inputs.slice(); cur.time = race.time;
    cur.prog = reason === "laps" ? 1 : car.prog;
    if (reason === "laps") stageClear(); else runOver();
  },
};

function stageClear() {
  const cleared = run.stage;
  const bonus = TIMER.bonus * run.build.bonus;
  addBonus(run, bonus);
  emit("stage-clear", { stage: cleared, bonus });
  run.offer = offerFor(run.day, cleared, run.picks);
  loadStage(cleared + 1);              // shows behind the offer screen
  emit("offer", { cleared, bonus, mods: run.offer });
}

function runOver() {
  run.over = true;
  const score = { stages: run.stage - 1, prog: car.prog, picks: run.picks.slice() };
  const isBest = beats(score, run.bestDay);
  if (isBest) { run.bestDay = score; storage.write(bestKeyDay(run.day), JSON.stringify(score)); }
  if (beats(score, run.bestAll)) {
    run.bestAll = { ...score, day: run.day };
    storage.write(BEST_KEY_ALL, JSON.stringify(run.bestAll));
  }
  setRules(null);
  emit("run-over", { score, best: run.bestDay, isBest, picks: run.picks.slice() });
}

/** Start a run on `day` (default today) from stage 1, with the countdown. */
export function startRun(day = todayUtc()) {
  if (run.active) leave();
  run.active = true; run.over = false; run.day = day;
  run.stage = 0; run.timer = TIMER.start; run.lowArmed = true;
  run.picks = []; run.build = buildFrom([]); run.stages = []; run.offer = [];
  loadBests(day);
  savedGuides = guides.visible; guides.visible = false;
  setRules(runRules);
  loadStage(1);
  emit("run-start", { day });
  start();
  emit("stage-start", 1);
}

/** Take a card from the current offer and start the next stage at once. */
export function pick(id) {
  if (!run.active || run.over || race.running || !run.offer.length) return;
  if (id !== SKIP.id && !run.offer.includes(id)) return;
  if (!canPick(run.picks, id)) return;
  run.picks.push(id);
  if (id === SKIP.id) addBonus(run, TIMER.skip);
  else {
    run.build = buildFrom(run.picks);
    track.halfW = HALF_W * run.build.halfW;
    race.params = run.build.T;
  }
  run.offer = [];
  startStage();
  emit("stage-start", run.stage);
}

// Put the loop back to the daily race's rules without loading a track.
function leave() {
  setRules(null);
  race.running = false; race.finished = false;
  run.active = false; run.over = false; run.offer = [];
  guides.visible = savedGuides;
}

/** Abandon the current run and start a fresh one on the same day. */
export function restart() {
  if (!run.active) return;
  startRun(run.day);
}

/** Abandon the run and go back to the daily race for the run's day. */
export function abandon() {
  if (!run.active) return;
  const day = run.day;
  leave();
  loadTrack(day);
}
