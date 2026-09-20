// Web Worker: builds the track from its seed, searches for the optimal line,
// and posts progress then the finished markers. No DOM in here — everything it
// imports is the same pure dynamics the game runs.

import { loadTrackGeometry } from "../track/track.js";
import { T } from "../config/tuning.js";
import { findLine } from "./optimizer.js";

/**
 * Turn the trace of input toggles into drawable markers. A press that is held
 * at least chargeUp seconds breaks traction — that is a real drift, and gets a
 * full entry/exit marker pair. Shorter presses are steering taps and get a
 * small tick, so the line stays readable.
 */
function markersFromToggles(toggles, endTime) {
  const out = [];
  for (let i = 0; i < toggles.length; i++) {
    const t = toggles[i], next = toggles[i + 1];
    const base = { lap: t.lap, idx: t.idx, x: +t.x.toFixed(1), y: +t.y.toFixed(1), a: +t.a.toFixed(3), P: +t.P.toFixed(4) };
    if (t.inp !== 0) {
      const held = (next ? next.t : endTime) - t.t;
      out.push({ ...base, type: "press", dir: t.inp, long: held >= T.chargeUp });
    } else {
      const prev = toggles[i - 1];
      const held = prev ? t.t - prev.t : 0;
      out.push({ ...base, type: "release", dir: prev ? prev.inp : 0, long: held >= T.chargeUp });
    }
  }
  return out;
}

self.onmessage = (e) => {
  const { seed } = e.data;
  loadTrackGeometry(seed);
  const r = findLine({
    onProgress: p => self.postMessage({ type: "progress", ...p }),
  });
  self.postMessage({
    type: "done",
    data: {
      time: r.time, off: r.off, feasible: r.feasible,
      segments: r.schedule.length,
      markers: markersFromToggles(r.toggles, r.time),
    },
  });
};
