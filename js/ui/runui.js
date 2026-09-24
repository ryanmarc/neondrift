// The run's screens: the title button's best line, the offer between stages
// and the run-over recap. Reacts to run events; drives the run only through
// run/run.js's exported actions.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { isDateSeed, todayUtc } from "../config/params.js";
import { track } from "../track/track.js";
import { run } from "../run/state.js";
import { pick, abandon, startRun, loadBests } from "../run/run.js";
import { beats } from "../run/stages.js";
import { byId, SKIP, held } from "../run/mods.js";
import * as SFX from "../audio/sfx.js";

const $overlay = $("overlay");
const $offer = $("offer"), $offerhead = $("offerhead"), $cards = $("cards");
const $runover = $("runover"), $roscore = $("roscore"), $robest = $("robest"), $romods = $("romods");
const $runbestline = $("runbestline");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function card(id) {
  const m = id === SKIP.id ? SKIP : byId.get(id);
  const n = held(run.picks, id);
  const pips = m.max > 1 ? '<span class="pips">' + "●".repeat(n) + "○".repeat(m.max - n) + "</span>" : "";
  return '<button type="button" class="card' + (id === SKIP.id ? " skip" : "") + '" data-id="' + esc(id) + '" data-pad>'
    + '<span class="cname">' + esc(m.name) + pips + "</span>"
    + '<span class="cgain">' + esc(m.gain) + "</span>"
    + (m.cost ? '<span class="ccost">' + esc(m.cost) + "</span>" : "")
    + "</button>";
}

function showOffer({ cleared, bonus, mods }) {
  $offerhead.textContent = "STAGE " + cleared + " CLEAR · +" + (Number.isInteger(bonus) ? bonus : bonus.toFixed(1)) + "s";
  $cards.innerHTML = mods.map(card).join("") + card(SKIP.id);
  $runover.classList.remove("on");
  $offer.classList.add("on");
  $overlay.classList.remove("gone");
}

$cards.addEventListener("click", e => {
  const b = e.target.closest(".card");
  if (!b) return;
  e.stopPropagation();
  SFX.unlock();
  pick(b.dataset.id);
});

function modList(picks) {
  const seen = new Map();
  for (const id of picks) if (id !== SKIP.id) seen.set(id, (seen.get(id) || 0) + 1);
  if (!seen.size) return "No mods held.";
  return [...seen].map(([id, n]) => esc(byId.get(id).name) + (n > 1 ? " ×" + n : "")).join(" · ");
}

function showRunOver({ score, best, isBest }) {
  $roscore.textContent = "STAGE " + score.stages;
  $robest.textContent = isBest ? "New best for the day." : (best ? "Best today: stage " + best.stages : "");
  $robest.classList.toggle("new", isBest);
  $romods.innerHTML = modList(score.picks);
  $offer.classList.remove("on");
  $runover.classList.add("on");
  $overlay.classList.remove("gone");
}

$("runagain").addEventListener("click", e => { e.stopPropagation(); SFX.unlock(); startRun(run.day); });
$("rundaily").addEventListener("click", e => { e.stopPropagation(); abandon(); });

// The title screen's best line follows the day browser: a run belongs to the day shown.
function syncTitle() {
  if (run.active) return;
  loadBests(isDateSeed(track.seed) ? track.seed : todayUtc());
  let text = run.bestDay ? "Best: stage " + run.bestDay.stages : "";
  if (run.bestAll && beats(run.bestAll, run.bestDay)) {
    text += text ? " · best ever: stage " + run.bestAll.stages : "Best ever: stage " + run.bestAll.stages;
  }
  $runbestline.textContent = text;
}

on("track-loaded", () => {
  document.body.classList.remove("run");
  $offer.classList.remove("on"); $runover.classList.remove("on");
  syncTitle();
});
on("run-start", () => {
  document.body.classList.add("run");
  $offer.classList.remove("on"); $runover.classList.remove("on");
});
on("stage-start", () => $offer.classList.remove("on"));
on("offer", showOffer);
on("run-over", showRunOver);
syncTitle();
