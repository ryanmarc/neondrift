// The daily track's rollover: when midnight UTC passes with the daily track
// loaded and no race running, the new day's track is loaded in place. Also
// the day browser: stepping to earlier days' tracks, whose boards stay open.
// The date helpers themselves live in config/params.js.

import { on } from "../core/events.js";
import { todayUtc, isDateSeed, shiftDate, FIRST_DAY } from "../config/params.js";
import { track } from "../track/track.js";
import { race } from "./state.js";
import { loadTrack } from "./race.js";

let daily = false;   // is the loaded track today's (as opposed to a chosen seed)?

/** True when the current track is the daily one. */
export function isDaily() { return daily; }

on("track-loaded", () => { daily = track.seed === todayUtc(); });

/** The date the day browser is on: the loaded seed if it is a date, else today. */
function currentDay() { return isDateSeed(track.seed) ? track.seed : todayUtc(); }

/** Can the day browser step `delta` days (±1) from here? Bounded by FIRST_DAY and today. */
export function canGoDay(delta) {
  const to = shiftDate(currentDay(), delta);
  return to >= FIRST_DAY && to <= todayUtc();
}

/** Load the track `delta` days from the current one, clamped to [FIRST_DAY, today]. */
export function gotoDay(delta) {
  if (race.running || !canGoDay(delta)) return;
  loadTrack(shiftDate(currentDay(), delta));
}

/** Load today's track. */
export function gotoToday() {
  if (race.running) return;
  if (track.seed !== todayUtc()) loadTrack(todayUtc());
}

function check() {
  if (daily && !race.running && track.seed !== todayUtc()) loadTrack(todayUtc());
}
setInterval(check, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
