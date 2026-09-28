// Live mode's screens: the title section's status line, the results between
// rounds, and the Leave buttons. Reacts to live events; drives the mode only
// through live/live.js's exported actions.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { live, serverNow } from "../live/state.js";
import { phaseAt } from "../live/clock.js";
import { leaveLive } from "../live/live.js";
import { playerId } from "../net/identity.js";
import { setMyId } from "./livehud.js";
import { race } from "../game/state.js";
import { LIVE_FLAG } from "../config/params.js";

// dark launch: without ?live the title screen has no Live section at all
if (!LIVE_FLAG) $("livemode").style.display = "none";

const $overlay = $("overlay"), $status = $("livestatus");
const $head = $("lrhead"), $list = $("lrlist"), $next = $("lrnext");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const STATUS = {
  joining: "Joining…",
  unavailable: "Live is unavailable right now.",
  displaced: "Live is open in another tab.",
  idle: "You were idle, so you left the room.",
  practice: "Live is off while ?weather is set.",
};

let myId = null;

function rows(list) {
  if (!list.length) return '<li><span>No laps set this round.</span></li>';
  return list.map((s, k) =>
    '<li class="' + (s.id === myId ? "me" : "") + '"><span>' + (k + 1) + ". " + esc(s.name) + '<span class="tag">#' + esc(s.tag) + "</span></span><span>" + s.time.toFixed(2) + "</span></li>").join("");
}

/** Between rounds (or waiting to join one): the overlay shows the standings. */
function showWaiting() {
  const final = !!live.results;
  $head.textContent = final ? "ROUND RESULTS" : "ROUND ENDING";
  $list.innerHTML = rows(live.standings);
  $overlay.classList.remove("gone");
}

function tickNext() {
  if (!live.active) return;
  const ph = phaseAt(serverNow());
  $next.textContent = ph.racing ? "" : "Next map in " + Math.ceil(ph.left) + "s";
  if (!ph.racing && !race.running && $overlay.classList.contains("gone")) showWaiting();
}
setInterval(tickNext, 250);

on("live-state", async () => {
  document.body.classList.toggle("live", live.active);
  $status.textContent = STATUS[live.status] || "";
  if (live.active && live.status === "joining") { $head.textContent = "JOINING"; $list.innerHTML = ""; $overlay.classList.remove("gone"); }
  // welcome arrived mid-results: the overlay is already up (from "joining" above,
  // or from a reconnect), but it may still show the stale JOINING text/empty
  // list rather than this round's standings — refresh it from live.standings.
  if (live.active && live.status === "on" && !$overlay.classList.contains("gone") && !race.running) showWaiting();
  if (live.active && !myId) { myId = await playerId(); setMyId(myId); }
});
on("live-results", showWaiting);
on("live-standing", () => { if (!$overlay.classList.contains("gone")) $list.innerHTML = rows(live.standings); });
on("live-leave", () => {
  document.body.classList.remove("live");
  // leaveLive() can fire mid-attempt (Leave, displacement, unavailable): race-start
  // left "gone" on the overlay and nothing else removes it on this path, so without
  // this the title screen never reappears. Matches hud.js's track-loaded handling.
  $overlay.classList.remove("gone", "done");
  $head.textContent = ""; $list.innerHTML = ""; $next.textContent = "";
});

$("liveleave").addEventListener("click", e => { e.stopPropagation(); leaveLive(); });
$("liveexit").addEventListener("click", e => { e.stopPropagation(); leaveLive(); });
