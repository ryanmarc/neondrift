// Per-frame readouts for a run: stage, best, the clock and its bar. Called by
// hud.js's updateHud() in place of the daily readouts while a run is active.

import { $ } from "../core/dom.js";
import { run } from "../run/state.js";
import { TIMER, capFor } from "../run/timer.js";

const $runstage = $("runstage"), $runbest = $("runbest"), $runtimer = $("runtimer"), $timefill = $("timefill");

export function updateRunHud() {
  $runstage.textContent = "STAGE " + run.stage;
  $runbest.textContent = run.bestDay ? "best: stage " + run.bestDay.stages : "";
  const low = run.timer <= TIMER.low;
  // Blindfold hides the clock until it is low; then the warning shows, not the number.
  const hidden = run.build.hideClock;
  $runtimer.textContent = hidden ? (low ? "LOW" : "") : run.timer.toFixed(1);
  $runtimer.classList.toggle("low", low);
  $timefill.style.width = hidden && !low ? "0%" : (100 * run.timer / capFor(run.build)).toFixed(1) + "%";
  $timefill.classList.toggle("low", low);
}
