// The current run, mutated in place by run/run.js and read by the HUD. A leaf
// module (no game imports) so the UI can read it without a cycle.

import { baseBuild } from "./mods.js";

export const run = {
  active: false,      // a run is in progress (including its offer and run-over screens)
  over: false,        // the run-over screen is up
  day: "",            // the day seed the run belongs to
  stage: 0,           // 1-based; the stage being driven, or just loaded
  timer: 0,           // seconds left
  picks: [],          // mod ids in pick order; repeats are levels; "skip" appears too
  build: baseBuild(), // = buildFrom(picks)
  stages: [],         // [{ seed, id, inputs, time, prog }] one per stage started
  offer: [],          // the mod ids on the current offer screen
  lowArmed: true,     // timer-low fires once per dip
  bestDay: null,      // { stages, prog, picks } for run.day, or null
  bestAll: null,      // { stages, prog, picks, day } or null
};
