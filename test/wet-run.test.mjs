// A wet stage should be harder to drive, not a death sentence: the clock a
// bootstrap drive nets on a wet stage (refill − drain) is within ±10% of dry.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry, forceWeather } = await import(new URL("track/track.js", root));
const { bootstrap, simulate } = await import(new URL("sim/simulate.js", root));
const { SLIDING } = await import(new URL("game/dynamics.js", root));
const { PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { TIMER, drainRate } = await import(new URL("run/timer.js", root));
const { buildFrom } = await import(new URL("run/mods.js", root));
const { stageSeed, stageShape } = await import(new URL("run/stages.js", root));

const DAY = "2026-10-02", CHAIN = 2;   // a mid-run chain, as a stage is entered in practice

/** Net seconds on the clock over one stage: refill (tickTimer's formula) minus drain. */
function netClock(n, wet) {
  const b = buildFrom([]);
  forceWeather(wet ? "wet" : "dry");
  loadTrackGeometry(stageSeed(DAY, n), stageShape(n));
  const start = car => { car.mult = CHAIN; };
  const { schedule } = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1, P: b.T, start });
  let refill = 0;
  const r = simulate(schedule, {
    laps: 1, P: b.T, start, maxTime: 60,
    observe(car, inp, flags) {
      if ((flags & SLIDING) && car.mult >= b.refillFloorMult) {
        const wetGain = track.wet ? (TIMER.wetGain ?? 1) : 1;
        refill += PHYSICS_DT * TIMER.refill * car.drift * Math.min(1, Math.hypot(car.vx, car.vy) / b.T.maxSpeed) * car.mult * b.refill * wetGain;
      }
    },
  });
  forceWeather(null);
  return refill - r.time * drainRate(n, b);
}

test("wet stages net within ±10% of dry on the run's clock", () => {
  let dry = 0, wet = 0;
  for (let n = 1; n <= 8; n++) { dry += netClock(n, false); wet += netClock(n, true); }
  console.log("net clock stages 1–8: dry " + dry.toFixed(1) + "s, wet " + wet.toFixed(1) + "s");
  assert.ok(Math.abs(wet - dry) <= Math.abs(dry) * 0.10, "wet " + wet.toFixed(1) + " vs dry " + dry.toFixed(1));
});

test("Wide road's rebuild of a stage keeps its weather", () => {
  for (let n = 1; n <= 40; n++) {
    const seed = stageSeed(DAY, n);
    loadTrackGeometry(seed, stageShape(n));
    const w = track.wet;
    loadTrackGeometry(seed, { ...stageShape(n), lapScale: 1.15 });
    assert.equal(track.wet, w, seed);
  }
});
