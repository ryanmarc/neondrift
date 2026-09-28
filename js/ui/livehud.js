// Per-frame readouts for live mode: the round clock, your best and rank, and
// the top five. Called by hud.js's updateHud() alongside the daily readouts
// (clock, delta and best still apply: a live attempt is a one-lap race).

import { $ } from "../core/dom.js";
import { live, serverNow } from "../live/state.js";
import { phaseAt } from "../live/clock.js";

const $clock = $("liveclock"), $rank = $("liverank"), $top = $("livetop");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = t => t.toFixed(2);
const clockText = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

let myId = null;
export function setMyId(id) { myId = id; }

let lastTop = "";
export function updateLiveHud() {
  const ph = phaseAt(serverNow());
  const wx = live.status === "offline" ? " · RECONNECTING" : "";
  $clock.textContent = (ph.racing ? clockText(ph.left) + " LEFT" : "RESULTS") + wx;
  const i = live.standings.findIndex(s => s.id === myId);
  $rank.textContent = i >= 0 ? "#" + (i + 1) + " of " + live.standings.length : (live.standings.length ? "unranked" : "");
  // the list only changes on a standing, so rebuild its HTML only then
  const html = live.standings.slice(0, 5).map((s, k) =>
    '<li class="' + (s.id === myId ? "me" : "") + '">' + (k + 1) + ". " + esc(s.name) + '<span class="tag">#' + esc(s.tag) + "</span> " + fmt(s.time) + "</li>").join("");
  if (html !== lastTop) { $top.innerHTML = html; lastTop = html; }
}
