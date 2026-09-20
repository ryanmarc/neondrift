// The daily track's rollover: when midnight UTC passes with the daily track
// loaded and no race running, the new day's track is loaded in place. The
// date helpers themselves live in config/params.js.

import { on } from "../core/events.js";
import { todayUtc } from "../config/params.js";
import { track } from "../track/track.js";
import { race } from "./state.js";
import { loadTrack } from "./race.js";

let daily = false;   // is the loaded track today's (as opposed to a chosen seed)?

/** True when the current track is the daily one. */
export function isDaily() { return daily; }

on("track-loaded", () => { daily = track.seed === todayUtc(); });

function check() {
  if (daily && !race.running && track.seed !== todayUtc()) loadTrack(todayUtc());
}
setInterval(check, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
