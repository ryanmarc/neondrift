// DEV PANEL — temporary test controls. To remove: delete this file, its import
// in main.js, the DEV PANEL block in index.html and the one in style.css.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { todayUtc, DEV_FLAG } from "../config/params.js";
import { track } from "../track/track.js";
import { guides } from "../track/guides.js";
import { car, race } from "../game/state.js";
import { ghost } from "../game/ghost.js";
import { camera } from "../render/camera.js";
import { loadTrack, start, tick } from "../game/race.js";
import { setGuidesVisible } from "./controls.js";
import { setSeedOverride } from "./hud.js";
import { line, ensureLine } from "../sim/line.js";
import * as audio from "../audio/context.js";
import * as music from "../audio/music.js";

const cb = $("devGuides");
const box = $("devSeed");
const $result = $("result"), $go = $("go");

$("devpanel").classList.toggle("on", DEV_FLAG);   // hidden unless the flag is set

cb.checked = guides.visible;
cb.addEventListener("change", () => setGuidesVisible(cb.checked));

function apply(seed) {
  if (!seed) return;
  setSeedOverride(seed !== todayUtc());
  loadTrack(seed);
  $result.innerHTML = '<span class="note">Loaded track from seed "' + seed + '".</span>';
  $go.textContent = "TAP TO RACE";
}
on("track-loaded", () => { box.value = track.seed; });

$("devLoad").addEventListener("click", e => { e.stopPropagation(); apply(box.value.trim()); });
$("devRandom").addEventListener("click", e => {
  e.stopPropagation(); apply("rnd-" + Math.random().toString(36).slice(2, 10));
});
box.addEventListener("keydown", e => {
  e.stopPropagation();                       // don't let typing steer the car
  if (e.key === "Enter") apply(box.value.trim());
});
box.addEventListener("keyup", e => e.stopPropagation());

// Poke at live state from the browser console: window.neon.car, .race, .track…
window.neon = { car, race, track, ghost, guides, camera, line, audio, music, loadTrack, start, tick, ensureLine };
