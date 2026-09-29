// What the chain multiplier readout shows: the DOM chain above the boost bar and
// the cockpit's dash gauge both draw from this, so they can never disagree.
// Faint near ×1 and brightening as it builds; a break above ×1.4 (physics.js sets
// race.breakT) reads "×2.8 LOST", or "×3.4 → ×1.9" when a run keeps part of it.
// Pure: no DOM.

import { clamp } from "../core/math.js";

export function chainReadout(race, car) {
  if (race.breakT > 0) {
    return {
      state: "broke", mult: race.lostMult,
      text: "×" + race.lostMult.toFixed(1),
      note: race.keptMult > 1.05 ? "→ ×" + race.keptMult.toFixed(1) : "LOST",
      alpha: Math.min(1, race.breakT * 1.8), scale: 1 + 0.14 * race.breakT, snap: race.breakT > 0.55,
    };
  }
  if (car.mult > 1.05) {
    const t = clamp((car.mult - 1) / 3, 0, 1);
    return { state: "chain", mult: car.mult, text: "×" + car.mult.toFixed(1), note: "",
      alpha: 0.40 + 0.60 * t, scale: 1 + 0.16 * t, snap: false };
  }
  return { state: "idle", mult: car.mult, text: "×" + car.mult.toFixed(1), note: "", alpha: 0, scale: 1, snap: false };
}
