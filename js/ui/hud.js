// Everything on screen that isn't the canvas: clock, lap, delta, boost bar,
// chain multiplier, countdown caption, control hint, seed label, end screen.
// Reads game state; reacts to game events; never drives the game.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { clamp } from "../core/math.js";
import { LAPS, T_TICK, T_GO } from "../config/tuning.js";
import { SEED_OVERRIDE, todayUtc, describeUntilRollover } from "../config/params.js";
import { track } from "../track/track.js";
import { car, race } from "../game/state.js";
import { ghost, ghostTimeAtProgress, clearGhost } from "../game/ghost.js";
import { line } from "../sim/line.js";

const $clock = $("clock"), $lap = $("lap"), $delta = $("delta"), $best = $("best");
const $fill = $("fill"), $chain = $("chain"), $meter = $("meter");
const $countdown = $("countdown");
const $overlay = $("overlay"), $result = $("result"), $go = $("go"), $seed = $("seed");
const $rule = $("rule"), $clear = $("clearghost"), $line = $("line"), $next = $("next");

export const fmt = t => t.toFixed(2);

// ---------- per-frame readouts ----------

export function updateHud() {
  $clock.textContent = fmt(race.time);
  $lap.textContent = "Lap " + clamp(car.lap, 1, LAPS) + " of " + LAPS;
  // the fill carries a glow, so at width 0 it still smears; hide it outright when empty
  $fill.style.width = (car.boost * 100) + "%";
  $fill.style.opacity = car.boost < 0.004 ? "0" : "1";
  $fill.classList.toggle("hot", car.boosting);
  $best.textContent = ghost.bestTime != null ? "Best " + fmt(ghost.bestTime) : "";

  const gt = ghostTimeAtProgress(car.lap - 1 + car.prog);
  if (gt != null && race.running && race.countdown <= 0) {
    const d = race.time - gt;
    $delta.textContent = (d >= 0 ? "+" : "") + d.toFixed(2);
    $delta.style.color = d < 0 ? "#2fe3ff" : "#ff2f9e";
  } else $delta.textContent = "";

  if (race.breakT > 0) {
    $chain.textContent = "×" + race.lostMult.toFixed(1) + " LOST";
    $chain.className = "broke";
    $chain.style.opacity = Math.min(1, race.breakT * 1.8).toFixed(2);
    $chain.style.transform = "scale(" + (1 + 0.14 * race.breakT).toFixed(3) + ")";
    $meter.classList.toggle("snap", race.breakT > 0.55);
  } else if (car.mult > 1.05) {
    // stays on screen the whole time you're chained, so you can watch it build
    const t = clamp((car.mult - 1) / 3, 0, 1);
    $chain.textContent = "×" + car.mult.toFixed(1);
    $chain.className = "";
    $chain.style.opacity = (0.40 + 0.60 * t).toFixed(2);
    $chain.style.transform = "scale(" + (1 + 0.16 * t).toFixed(3) + ")";
    $meter.classList.remove("snap");
  } else {
    $chain.style.opacity = 0;
    $meter.classList.remove("snap");
  }
}

export function updateCountdown() {
  if (race.countdown > 0) {
    const f = (race.countdown % T_TICK) / T_TICK;   // 1 just appeared, 0 about to flip
    $countdown.textContent = Math.ceil(race.countdown / T_TICK);
    $countdown.className = "";
    $countdown.style.opacity = Math.min(1, f * 2.4).toFixed(2);
    $countdown.style.transform = "translate(-50%,-50%) scale(" + (1 + 0.45 * f).toFixed(3) + ")";
  } else if (race.goTimer > 0) {
    const f = race.goTimer / T_GO;
    $countdown.textContent = "GO";
    $countdown.className = "go";
    $countdown.style.opacity = f.toFixed(2);
    $countdown.style.transform = "translate(-50%,-50%) scale(" + (1.9 - 0.9 * f).toFixed(3) + ")";
  } else {
    $countdown.style.opacity = 0;
  }
}

// ---------- seed label ----------

let seedOverridden = SEED_OVERRIDE;

/** Mark the seed label as an override (anything but today's track). */
export function setSeedOverride(v) { seedOverridden = v; }

function refreshSeed() {
  $seed.innerHTML = "TRACK " + track.seed + " / " + track.id.toUpperCase()
    + (seedOverridden ? ' <span class="override">override</span>' : "");
}

// ---------- optimal line status ----------

function refreshLine() {
  let text = "";
  if (line.status === "computing") {
    text = "FINDING LINE · " + Math.round(line.progress * 100) + "%" + (line.time != null ? " · " + fmt(line.time) : "");
  } else if (line.status === "ready") {
    text = line.feasible ? "IDEAL LINE " + fmt(line.time) : "LINE " + fmt(line.time) + " · leaves the road";
  } else if (line.status === "failed") {
    text = "LINE UNAVAILABLE";
  }
  $line.textContent = text;
  $line.style.display = text ? "block" : "none";
  $go.disabled = line.status === "computing";   // no racing until the line is ready
}

// ---------- daily rollover countdown ----------

function refreshNext() {
  const show = track.seed === todayUtc();   // only the daily track changes on a schedule
  $next.textContent = show ? "Track will change in " + describeUntilRollover() + "." : "";
  $next.style.display = show ? "block" : "none";
}
setInterval(refreshNext, 15000);

// ---------- control hint ----------

// Which control hint to show. Rather than sniffing the user agent (which gets
// touchscreen laptops and keyboard tablets wrong), start from a capability query
// and then correct it the moment the player actually uses something.
let inputMode = (window.matchMedia && matchMedia("(pointer: coarse)").matches) ? "pointer" : "keys";

function setInputMode(mode) {
  if (mode && mode === inputMode) return;
  if (mode) inputMode = mode;
  $rule.innerHTML = inputMode === "pointer"
    ? 'Hold <b>either side</b> of the screen to turn.'
    : 'Hold the <b>left or right arrow key</b> to turn.';
}

// ---------- overlay / end screen ----------

function syncClear() { $clear.style.display = (ghost.data || ghost.bestTime != null) ? "block" : "none"; }

$clear.addEventListener("click", e => {
  e.stopPropagation();
  clearGhost();
  $result.innerHTML = "Ghost and best time cleared. Next run sets the new pace.";
  syncClear();
});

function showResult({ time, prevBest, isPB }) {
  let line;
  if (prevBest == null) {
    line = '<span class="note">First run on this track. Your ghost is saved.</span>';
  } else {
    const d = time - prevBest;
    line = '<span class="' + (d < 0 ? "faster" : "slower") + '">' + (d < 0 ? "−" : "+") + Math.abs(d).toFixed(2) + '</span>'
         + '<span class="note"> ' + (d < 0 ? "on your best of " + fmt(prevBest) : "off your best of " + fmt(prevBest)) + '</span>';
  }
  $result.innerHTML = '<span class="big' + (isPB ? ' pb' : '') + '">' + fmt(time) + '</span>' + line;
  $go.textContent = "RACE AGAIN";
  syncClear();
  $overlay.classList.add("done");          // recap: hide the how-to
  $overlay.classList.remove("gone");
}

// ---------- wiring ----------

on("track-loaded", () => { refreshSeed(); syncClear(); refreshNext(); $overlay.classList.remove("done"); });
on("race-start", () => $overlay.classList.add("gone"));
on("race-finish", showResult);
on("input-mode", setInputMode);
on("line-updated", refreshLine);

setInputMode();
syncClear();
refreshLine();
refreshNext();
