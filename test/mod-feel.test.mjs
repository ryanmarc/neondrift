// The design bar for a run mod: a car or character card at level 1 must move
// at least one handling metric by 15% against the base build, measured by
// driving a fixed stage with the bootstrap controller. Prints the table so
// tuning is a matter of reading it.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { PHYSICS_DT, HALF_W } = await import(new URL("config/tuning.js", root));
const { SLIDING } = await import(new URL("game/dynamics.js", root));
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { bootstrap, simulate } = await import(new URL("sim/simulate.js", root));
const { stageShape } = await import(new URL("run/stages.js", root));
const { MODS, buildFrom } = await import(new URL("run/mods.js", root));

const SEED = "2026-09-24#run4", SHAPE = stageShape(4), BAR = 0.15;
const METRICS = ["lapTime", "peakSpeed", "launch", "peakDrift", "slideSec", "toSlide", "toGrip", "boostSec", "chainPeak"];
// Cards whose effect needs a state a cold lap never reaches but a run does:
// a full meter (Long tank), a carried chain (Snowball). Measured in that state.
const CONTEXT = { tank: { boost: 1 }, snowball: { mult: 3 } };

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Drive the stage under a build and measure it. */
function measure(build, ctx = {}) {
  loadTrackGeometry(SEED, { ...SHAPE, lapScale: build.lapScale });
  track.halfW = HALF_W * build.halfW;
  const P = build.T;
  const start = car => { if (ctx.boost) car.boost = P.boostCap * ctx.boost; if (ctx.mult) car.mult = ctx.mult; };
  const { schedule } = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1, P, start });
  const m = { lapTime: 0, peakSpeed: 0, launch: 0, peakDrift: 0, slideSec: 0, toSlide: 0, toGrip: 0, boostSec: 0, chainPeak: 0 };
  // per hold: time from the hold to the slide; per release after a slide: time until grip is back
  const toSlide = [], toGrip = [];
  let holdAt = -1, slid = false, releaseAt = -1, prevInp = 0;
  const r = simulate(schedule, {
    laps: 1, P, maxTime: 60, start,
    observe(car, inp, flags, t) {
      const sp = Math.hypot(car.vx, car.vy);
      m.peakSpeed = Math.max(m.peakSpeed, sp);
      m.peakDrift = Math.max(m.peakDrift, car.drift);
      m.chainPeak = Math.max(m.chainPeak, car.mult);
      if (!m.launch && sp >= 480) m.launch = t;
      if (car.boosting) m.boostSec += PHYSICS_DT;
      if (flags & SLIDING) m.slideSec += PHYSICS_DT;
      if (inp !== 0 && prevInp === 0) { holdAt = t; slid = false; releaseAt = -1; }
      if (holdAt >= 0 && !slid && (flags & SLIDING)) { slid = true; toSlide.push(t - holdAt); }
      if (inp === 0 && prevInp !== 0) { releaseAt = slid ? t : -1; holdAt = -1; }
      if (releaseAt >= 0 && car.drift < P.driftMin) { toGrip.push(t - releaseAt); releaseAt = -1; }
      prevInp = inp;
    },
  });
  m.lapTime = r.time;
  m.toSlide = mean(toSlide);
  m.toGrip = mean(toGrip);
  return m;
}

const rel = (a, b) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a / b - 1));
const fmt = v => (Math.round(v * 100) / 100).toString().padStart(6);

test("every car and character card moves a handling metric by 15%", () => {
  const base = measure(buildFrom([]));
  for (const k of METRICS) assert.ok(Number.isFinite(base[k]), "base " + k + " is " + base[k]);
  const bases = { base };   // a card with a CONTEXT is compared against the base build in the same state
  for (const [id, ctx] of Object.entries(CONTEXT)) bases[id] = measure(buildFrom([]), ctx);
  console.log("card".padEnd(12) + METRICS.map(k => k.padStart(10)).join(""));
  console.log("base".padEnd(12) + METRICS.map(k => fmt(base[k]).padStart(10)).join(""));
  const failures = [];
  for (const mod of MODS) {
    if (mod.kind !== "car" && mod.kind !== "character") continue;
    const m = measure(buildFrom([mod.id]), CONTEXT[mod.id]);
    const b = bases[mod.id] || base;
    const change = Math.max(...METRICS.map(k => rel(m[k], b[k])));
    console.log(mod.id.padEnd(12) + METRICS.map(k => fmt(m[k]).padStart(10)).join("") + "  max Δ " + (100 * change).toFixed(0) + "%");
    if (!(change >= BAR)) failures.push(mod.id + " " + (100 * change).toFixed(0) + "%");   // NaN fails too
  }
  assert.deepEqual(failures, [], "under the 15% bar: " + failures.join(", "));
});
