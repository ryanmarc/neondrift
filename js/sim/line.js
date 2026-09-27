// Main-thread side of the optimal line: owns the `line` state the renderer and
// HUD read, runs the search in a Web Worker when a track needs it, and caches
// the result in localStorage keyed by track geometry, the physics constants and
// the search version — so a tuning change invalidates every stored line.

import { on, emit } from "../core/events.js";
import * as storage from "../core/storage.js";
import { hashStr } from "../core/random.js";
import { T, WET, LAPS, PHYSICS_DT } from "../config/tuning.js";
import { track } from "../track/track.js";
import { guides } from "../track/guides.js";
import { LINE_VERSION } from "./optimizer.js";

export const line = {
  status: "idle",     // idle | computing | ready | failed
  trackId: null,
  time: null,         // the line's finishing time (best so far while computing)
  feasible: false,    // true when the line never leaves the road
  markers: [],        // see worker.js markersFromToggles()
  stage: "",          // bootstrap | anneal | polish | done
  progress: 0,        // 0..1
};

// WET is in the hash so retuning it recomputes wet lines; the "-w" suffix keeps
// a wet road's line apart from the same geometry's dry one (?weather forces it).
const PHYSICS_HASH = hashStr(JSON.stringify(T) + "|" + JSON.stringify(WET) + "|" + LAPS + "|" + PHYSICS_DT).toString(36);
export const lineKey = (id, wet) => "neondrift:t" + id + ":line:v" + LINE_VERSION + "-" + PHYSICS_HASH + (wet ? "-w" : "");

let worker = null;
let lineWet = null;

/** Make sure a line exists (or is being computed) for the current track. */
export function ensureLine() {
  if (line.trackId === track.id && lineWet === track.wet && line.status !== "idle") return;
  line.trackId = track.id;
  lineWet = track.wet;
  const cached = storage.read(lineKey(track.id, track.wet));
  if (cached) {
    try { apply(JSON.parse(cached)); return; } catch { /* corrupt: recompute */ }
  }
  compute();
}

function apply(data) {
  line.status = "ready"; line.stage = "done"; line.progress = 1;
  line.time = data.time; line.feasible = data.feasible; line.markers = data.markers;
  emit("line-updated");
}

function compute() {
  line.status = "computing"; line.stage = "bootstrap"; line.progress = 0;
  line.time = null; line.feasible = false; line.markers = [];
  emit("line-updated");
  if (worker) worker.terminate();
  const id = track.id, wet = track.wet;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  } catch (err) {
    line.status = "failed"; emit("line-updated"); return;
  }
  worker.onmessage = (e) => {
    if (id !== track.id) return;               // a different track loaded meanwhile
    const m = e.data;
    if (m.type === "progress") {
      line.stage = m.stage; line.progress = m.fraction;
      line.time = m.bestTime; line.feasible = m.feasible;
      emit("line-updated");
    } else if (m.type === "done") {
      storage.write(lineKey(id, wet), JSON.stringify(m.data));
      apply(m.data);
      worker.terminate(); worker = null;
    }
  };
  worker.onerror = (err) => {
    console.error("line worker failed", err);
    line.status = "failed"; emit("line-updated");
    worker.terminate(); worker = null;
  };
  worker.postMessage({ seed: track.seed, wet: track.wet });
}

on("track-loaded", () => {
  if (worker) { worker.terminate(); worker = null; }
  line.status = "idle"; line.trackId = null; lineWet = null; line.markers = []; line.time = null; line.feasible = false;
  emit("line-updated");
  if (guides.visible) ensureLine();
});
