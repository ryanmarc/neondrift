// Best run per track: the time, and a 30Hz recording replayed as a ghost.
// Keyed by track geometry (track.id), so a ghost never appears on a track it
// wasn't set on.

import { lerp } from "../core/math.js";
import * as storage from "../core/storage.js";
import { GHOST_HZ } from "../config/tuning.js";

export const ghost = {
  data: null,       // flat [x, y, angle, progress, ...] or null
  bestTime: null,   // seconds, or null if no run saved for this track
  inputs: null,     // the saved best run's input changes, or null
  rival: null,      // { id, name, tag, time, data } — a leaderboard run raced instead of your own
};

/** Race this run instead of your own ghost (null to go back to your own). */
export function setRival(rival) { ghost.rival = rival; }

/** The recording currently being raced: the rival's if one is set, else your own. */
function activeData() { return ghost.rival ? ghost.rival.data : ghost.data; }

/** The time the live delta and "Best" line compare against, or null. */
export function targetTime() { return ghost.rival ? ghost.rival.time : ghost.bestTime; }

let keyBest = "", keyGhost = "", keyInputs = "";

/** Load whatever is saved for this track id (or nothing). */
export function loadGhost(trackId) {
  keyBest = "neondrift:t" + trackId + ":best";
  keyGhost = "neondrift:t" + trackId + ":ghost";
  keyInputs = "neondrift:t" + trackId + ":inputs";
  ghost.data = null; ghost.bestTime = null; ghost.inputs = null; ghost.rival = null;
  const b = storage.read(keyBest); if (b) ghost.bestTime = parseFloat(b);
  const g = storage.read(keyGhost); if (g) { try { ghost.data = JSON.parse(g); } catch { /* corrupt: ignore */ } }
  const i = storage.read(keyInputs); if (i) { try { ghost.inputs = JSON.parse(i); } catch { /* corrupt: ignore */ } }
}

/** A run's stages have no ghost; the daily one comes back with loadTrack. */
export function unloadGhost() {
  ghost.data = null; ghost.bestTime = null; ghost.inputs = null; ghost.rival = null;
}

/** Forget the saved run for this track. */
export function clearGhost() {
  ghost.data = null; ghost.bestTime = null; ghost.inputs = null;
  storage.remove(keyBest); storage.remove(keyGhost); storage.remove(keyInputs);
}

/**
 * Called at the finish line. Saves the run if it's a personal best and returns
 * what the end screen and the leaderboard need. prevBest is captured before it
 * is overwritten.
 */
export function commitRun(time, rec, inputs) {
  const prevBest = ghost.bestTime;
  const isPB = prevBest == null || time < prevBest;
  if (isPB) {
    ghost.bestTime = time;
    ghost.data = rec;
    ghost.inputs = inputs;
    storage.write(keyBest, String(time));
    storage.write(keyGhost, JSON.stringify(rec));
    storage.write(keyInputs, JSON.stringify(inputs));
  }
  return { time, prevBest, isPB, ghost: rec, inputs };
}

/** Ghost pose at race time t, interpolated between recorded frames. */
export function ghostAt(t) {
  const g = activeData();
  if (!g) return null;
  const f = t * GHOST_HZ, i = Math.floor(f);
  if (i >= g.length / 4 - 1) return null;
  const k = f - i, o = i * 4, o2 = o + 4;
  return { x: lerp(g[o], g[o2], k), y: lerp(g[o + 1], g[o2 + 1], k), a: g[o + 2] };
}

/**
 * Time at which the ghost reached track progress `pr` (lap-1 + fraction).
 * Lets the live delta compare the same point on track rather than the same clock.
 */
export function ghostTimeAtProgress(pr) {
  const g = activeData();
  if (!g) return null;
  const frames = g.length / 4;
  for (let i = 1; i < frames; i++) {
    const a = g[(i - 1) * 4 + 3], b = g[i * 4 + 3];
    if (b >= pr) { const t = (pr - a) / ((b - a) || 1); return (i - 1 + t) / GHOST_HZ; }
  }
  return null;
}
