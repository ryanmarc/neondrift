// Everything on screen that isn't the canvas: clock, lap, delta, boost bar,
// chain multiplier, countdown caption, control hint, seed label, end screen.
// Reads game state; reacts to game events; never drives the game.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { clamp } from "../core/math.js";
import { LAPS, T_TICK, T_GO } from "../config/tuning.js";
import { todayUtc, describeUntilRollover, describeDay } from "../config/params.js";
import { track } from "../track/track.js";
import { car, race } from "../game/state.js";
import { ghost, ghostTimeAtProgress, clearGhost, targetTime } from "../game/ghost.js";
import { line } from "../sim/line.js";
import { canGoDay, gotoDay, gotoToday } from "../game/daily.js";
import { run } from "../run/state.js";
import { updateRunHud } from "./runhud.js";

const $clock = $("clock"), $lap = $("lap"), $delta = $("delta"), $best = $("best");
const $fill = $("fill"), $chain = $("chain"), $meter = $("meter");
const $countdown = $("countdown");
const $overlay = $("overlay"), $result = $("result"), $go = $("go"), $gorun = $("gorun"), $seed = $("seed");
const $rule = $("rule"), $clear = $("clearghost"), $line = $("line"), $next = $("next");
const $dayprev = $("dayprev"), $daynext = $("daynext"), $daytoday = $("daytoday");

export const fmt = t => t.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- per-frame readouts ----------

export function updateHud() {
  if (run.active) updateRunHud();
  else {
    $clock.textContent = fmt(race.time);
    $lap.textContent = "Lap " + clamp(car.lap, 1, LAPS) + " of " + LAPS;
    if (ghost.rival) $best.innerHTML = "vs " + esc(ghost.rival.name) + '<span class="tag">#' + esc(ghost.rival.tag) + "</span> " + fmt(ghost.rival.time);
    else $best.textContent = ghost.bestTime != null ? "Best " + fmt(ghost.bestTime) : "";
    const gt = ghostTimeAtProgress(car.lap - 1 + car.prog);
    if (gt != null && race.running && race.countdown <= 0) {
      const d = race.time - gt;
      $delta.textContent = (d >= 0 ? "+" : "") + d.toFixed(2);
      $delta.style.color = d < 0 ? "#2fe3ff" : "#ff2f9e";
    } else $delta.textContent = "";
  }
  // the boost bar and the chain are shared by both modes
  $fill.style.width = (car.boost * 100) + "%";
  $fill.style.opacity = car.boost < 0.004 ? "0" : "1";
  $fill.classList.toggle("hot", car.boosting);

  if (race.breakT > 0) {
    $chain.textContent = "×" + race.lostMult.toFixed(1) + (race.keptMult > 1.05 ? " → ×" + race.keptMult.toFixed(1) : " LOST");
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

// ---------- seed label + day browser ----------

// The label says what the loaded track is relative to today: nothing for
// today's, "yesterday" / "3 days ago" for another day's, "override" for a
// seed that isn't a date at all (?seed=random or a custom string). The arrows step days.
function refreshSeed() {
  const today = todayUtc(), ago = describeDay(track.seed, today);
  let tag = "";
  if (ago == null) tag = ' <span class="override">override</span>';
  else if (ago !== "today") tag = ' <span class="ago">' + ago + "</span>";
  $seed.innerHTML = "TRACK " + track.seed + " / " + track.id.toUpperCase() + tag;
  $dayprev.disabled = !canGoDay(-1);
  $daynext.disabled = !canGoDay(1);
  $daytoday.classList.toggle("on", track.seed !== today);
  if (ago != null) syncUrl(today);   // only dates: leave ?seed=random / dev seeds alone
}

// Keep the address bar on the loaded day so a reload or a shared link lands
// there: ?seed=<date> away from today, no param on today. Best-effort.
function syncUrl(today) {
  try {
    const url = new URL(location.href);
    if (track.seed === today) url.searchParams.delete("seed");
    else url.searchParams.set("seed", track.seed);
    if (url.href !== location.href) history.replaceState(null, "", url);
  } catch { /* file:// or a sandboxed frame: the label still works */ }
}

$dayprev.addEventListener("click", e => { e.stopPropagation(); gotoDay(-1); });
$daynext.addEventListener("click", e => { e.stopPropagation(); gotoDay(1); });
$daytoday.addEventListener("click", e => { e.stopPropagation(); gotoToday(); });

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
  $gorun.disabled = line.status === "computing";
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

const deltaLine = (d, who) =>
  '<span class="' + (d < 0 ? "faster" : "slower") + '">' + (d < 0 ? "−" : "+") + Math.abs(d).toFixed(2) + '</span>'
  + '<span class="note"> ' + (d < 0 ? "on " : "off ") + who + "</span>";

function showResult({ time, prevBest, isPB }) {
  let line;
  if (ghost.rival) {
    // raced a leaderboard ghost: that comparison leads, your own best is the footnote
    line = deltaLine(time - ghost.rival.time, esc(ghost.rival.name) + '<span class="tag">#' + esc(ghost.rival.tag) + "</span> " + fmt(ghost.rival.time));
    if (prevBest != null) line += '<br><span class="note">' + (isPB ? "New personal best." : "Your best is " + fmt(prevBest) + ".") + "</span>";
    else line += '<br><span class="note">Your ghost is saved.</span>';
  } else if (prevBest == null) {
    line = '<span class="note">First run on this track. Your ghost is saved.</span>';
  } else {
    line = deltaLine(time - prevBest, "your best of " + fmt(prevBest));
  }
  $result.innerHTML = '<span class="big' + (isPB ? ' pb' : '') + '">' + fmt(time) + '</span>' + line;
  $go.textContent = "RACE AGAIN";
  syncClear();
  $overlay.classList.add("done");          // recap: hide the how-to
  $overlay.classList.remove("gone");
}

// ---------- wiring ----------

on("track-loaded", () => { refreshSeed(); syncClear(); refreshNext(); $overlay.classList.remove("done"); $go.textContent = "RACE THE DAILY"; });
on("challenge", ({ name, tag, time }) => {
  $result.innerHTML = '<span class="note">' + esc(name) + '<span class="tag">#' + esc(tag) + "</span> challenges you to beat </span>" + fmt(time) + ".";
});
on("race-start", () => $overlay.classList.add("gone"));
on("race-finish", showResult);
on("input-mode", setInputMode);
on("line-updated", refreshLine);

setInputMode();
syncClear();
refreshLine();
refreshNext();
