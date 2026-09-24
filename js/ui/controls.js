// The on-screen buttons and keyboard shortcuts that drive the game.

import { $ } from "../core/dom.js";
import { guides } from "../track/guides.js";
import { line, ensureLine } from "../sim/line.js";
import { camera } from "../render/camera.js";
import { start } from "../game/race.js";
import * as SFX from "../audio/sfx.js";
import * as Music from "../audio/music.js";
import { track } from "../track/track.js";
import { isDateSeed, todayUtc } from "../config/params.js";
import { run } from "../run/state.js";
import { startRun } from "../run/run.js";
import { padState, risingEdges, firstPad, stepIndex } from "../input/gamepad.js";
import { emit } from "../core/events.js";

// Audio must unlock inside a real tap handler — iOS refuses otherwise, and
// deferring it even one frame fails. So every start button unlocks first.
// While the optimal line is being computed the race button is disabled (hud.js);
// the shortcuts honour the same rule so it can't be bypassed from the keyboard.
const canStart = () => line.status !== "computing";
// Restart is the daily race's only. A run has no restart: its screens offer
// "run again" and "back to the daily race" at the end, and the button is hidden.
const restart = () => { if (!run.active) start(); };
// A run belongs to the day on the title screen, so the day browser gives past days' runs too.
const runDay = () => isDateSeed(track.seed) ? track.seed : todayUtc();
$("go").addEventListener("click", e => { e.stopPropagation(); if (!canStart()) return; SFX.unlock(); start(); });
$("gorun").addEventListener("click", e => { e.stopPropagation(); if (!canStart()) return; SFX.unlock(); startRun(runDay()); });
$("restart").addEventListener("click", e => { e.stopPropagation(); if (!canStart()) return; SFX.unlock(); restart(); });
addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && canStart()) restart(); });

const $guides = $("guidetoggle");
if (!guides.flag) $guides.style.display = "none";
$guides.addEventListener("click", e => { e.stopPropagation(); setGuidesVisible(!guides.visible); });

/** Toggle the drift guides and keep the button label in sync. Inert mid-run:
 * the daily track's optimal line doesn't match a run stage's shorter sample
 * array, and the renderer throws indexing into it. */
export function setGuidesVisible(v) {
  if (run.active) return;
  guides.visible = v;
  $guides.textContent = "Guides: " + (v ? "on" : "off");
  if (v) ensureLine();
}

// Effects and music each have a button in the HUD and one on the overlay
// (title and end screens). All four read from the same two switches.
const $fx = [$("mute"), $("overlaySfx")], $mu = [$("musictoggle"), $("overlayMusic")];
function syncAudioButtons() {
  for (const b of $fx) b.textContent = "Sound FX: " + (SFX.isMuted() ? "off" : "on");
  for (const b of $mu) b.textContent = "Music: " + (Music.isEnabled() ? "on" : "off");
}
for (const b of $fx) b.addEventListener("click", e => { e.stopPropagation(); SFX.unlock(); SFX.toggleMute(); syncAudioButtons(); });
for (const b of $mu) b.addEventListener("click", e => { e.stopPropagation(); SFX.unlock(); Music.toggle(); syncAudioButtons(); });
syncAudioButtons();

const $cam = $("camtoggle");
$cam.addEventListener("click", e => {
  e.stopPropagation(); camera.chase = !camera.chase;
  $cam.textContent = "Camera: " + (camera.chase ? "chase" : "fixed");
});

// ---------- gamepad menus ----------
//
// Steering is polled by input.js; this is the rest of the pad. A focus ring
// moves between the visible screen's primary buttons (those marked data-pad:
// the two title buttons, race again, the mod cards and Skip, the run-over
// pair), A presses the focused one, B is the R key, LB/RB are the day arrows.
// Everything goes through the buttons' own click handlers, so the audio
// unlock, the line-computing guard and the run's Skip rule apply unchanged.
// Secondary links (rename, pairing, toggles) stay mouse-only on purpose:
// putting them in the ring would make the race button a five-press trip.
// The ring is only drawn once the pad has actually been used, so mouse and
// touch players never see it.
const $overlay = $("overlay");
let padPrev = padState(null), padEl = null, padUsed = false;

const padTargets = () =>
  [...$overlay.querySelectorAll("[data-pad]")].filter(el => !el.disabled && el.getClientRects().length > 0);

function pollPad() {
  const gp = navigator.getGamepads ? firstPad(navigator.getGamepads()) : null;
  const now = padState(gp), e = risingEdges(padPrev, now);
  padPrev = now;
  if (!gp) return;
  const step = (e.right || e.down) ? 1 : (e.left || e.up) ? -1 : 0;
  if ((step || e.a) && !padUsed) { padUsed = true; emit("input-mode", "pad"); }   // the title hint switches to pad wording
  const list = padTargets();
  // a screen change drops the focused button out of the list: restart at the first one
  let i = Math.max(0, list.indexOf(padEl));
  if (step) i = stepIndex(i, list.length, step);
  const next = list[i] || null;
  if (padEl && padEl !== next) padEl.classList.remove("padfocus");   // even if it's now hidden
  padEl = next;
  if (padEl) padEl.classList.toggle("padfocus", padUsed);
  if (e.a && padEl) padEl.click();
  if (e.b && canStart()) restart();
  if (e.lb) $("dayprev").click();
  if (e.rb) $("daynext").click();
}
setInterval(pollPad, 1000 / 60);
