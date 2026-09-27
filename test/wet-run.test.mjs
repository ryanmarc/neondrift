// A wet stage should be harder to drive, not a death sentence: the clock a
// bootstrap drive nets on a wet stage (refill − drain) stays close to dry's,
// pooled across several days so one day's noise can't make the band trivial.
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

// Several days, not one: a single day's dry net sits near zero, so a band
// relative to that one day is nearly free to pass. Pooling both the dry net
// and the dry refill across days gives the band a real denominator.
const DAYS = ["2026-10-02", "2026-10-03", "2026-10-10", "2026-11-05"];
const CHAIN = 2;   // a mid-run chain, as a stage is entered in practice

/** One stage's net seconds on the clock (refill − drain) and its raw refill. */
function stageClock(day, n, wet) {
  const b = buildFrom([]);
  forceWeather(wet ? "wet" : "dry");
  loadTrackGeometry(stageSeed(day, n), stageShape(n));
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
  return { net: refill - r.time * drainRate(n, b), refill };
}

test("wet stages net close to dry on the run's clock, pooled across days", () => {
  let dryNet = 0, wetNet = 0, dryRefill = 0;
  const rows = [];
  for (const day of DAYS) {
    let dNet = 0, wNet = 0, dRefill = 0;
    for (let n = 1; n <= 8; n++) {
      const d = stageClock(day, n, false), w = stageClock(day, n, true);
      dNet += d.net; wNet += w.net; dRefill += d.refill;
    }
    rows.push(day + ": dry " + dNet.toFixed(1) + "s, wet " + wNet.toFixed(1) + "s");
    dryNet += dNet; wetNet += wNet; dryRefill += dRefill;
  }
  const band = dryRefill * 0.05;
  console.log(rows.join(" | ") + " | pooled: dry " + dryNet.toFixed(1) + "s, wet " + wetNet.toFixed(1)
    + "s, dry refill " + dryRefill.toFixed(1) + "s, band ±" + band.toFixed(1) + "s");
  assert.ok(Math.abs(wetNet - dryNet) <= band, "pooled wet " + wetNet.toFixed(1) + " vs dry " + dryNet.toFixed(1) + " (band ±" + band.toFixed(1) + ")");
});

test("Wide road's rebuild of a stage keeps its weather", () => {
  for (let n = 1; n <= 40; n++) {
    const seed = stageSeed(DAYS[0], n);
    loadTrackGeometry(seed, stageShape(n));
    const w = track.wet;
    loadTrackGeometry(seed, { ...stageShape(n), lapScale: 1.15 });
    assert.equal(track.wet, w, seed);
  }
});
