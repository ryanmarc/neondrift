// The on-screen buttons and keyboard shortcuts that drive the game.

import { $ } from "../core/dom.js";
import { guides } from "../track/guides.js";
import { line, ensureLine } from "../sim/line.js";
import { camera } from "../render/camera.js";
import { start } from "../game/race.js";
import * as SFX from "../audio/sfx.js";

// Audio must unlock inside a real tap handler — iOS refuses otherwise, and
// deferring it even one frame fails. So every start button unlocks first.
// While the optimal line is being computed the race button is disabled (hud.js);
// the shortcuts honour the same rule so it can't be bypassed from the keyboard.
const canStart = () => line.status !== "computing";
$("go").addEventListener("click", e => { e.stopPropagation(); if (!canStart()) return; SFX.unlock(); start(); });
$("restart").addEventListener("click", e => { e.stopPropagation(); if (!canStart()) return; SFX.unlock(); start(); });
addEventListener("keydown", e => { if ((e.key === "r" || e.key === "R") && canStart()) start(); });

const $guides = $("guidetoggle");
if (!guides.flag) $guides.style.display = "none";
$guides.addEventListener("click", e => { e.stopPropagation(); setGuidesVisible(!guides.visible); });

/** Toggle the drift guides and keep the button label in sync. */
export function setGuidesVisible(v) {
  guides.visible = v;
  $guides.textContent = "Guides: " + (v ? "on" : "off");
  if (v) ensureLine();
}

const $mute = $("mute");
$mute.textContent = "Sound: " + (SFX.isMuted() ? "off" : "on");
$mute.addEventListener("click", e => {
  e.stopPropagation(); SFX.unlock();
  $mute.textContent = "Sound: " + (SFX.toggleMute() ? "off" : "on");
});

const $cam = $("camtoggle");
$cam.addEventListener("click", e => {
  e.stopPropagation(); camera.chase = !camera.chase;
  $cam.textContent = "Camera: " + (camera.chase ? "chase" : "fixed");
});
