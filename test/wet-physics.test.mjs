// Wet roads (track.wet): the dry path is untouched, wet changes the drive,
// and the worker replays a wet run on a wet road.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry, forceWeather } = await import(new URL("track/track.js", root));
const { bootstrap, simulate } = await import(new URL("sim/simulate.js", root));
const { SLIDING } = await import(new URL("game/dynamics.js", root));
const { PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { weatherFor } = await import(new URL("track/weather.js", root));

// A fixed drive on a fixed dry track: its exact time and final pose. Captured
// before wet physics existed; any change to the dry path moves these.
function fingerprint(seed) {
  loadTrackGeometry(seed);
  const { schedule } = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1 });
  let last = null;
  const r = simulate(schedule, { laps: 1, observe(car) { last = car; } });
  return { time: r.time, x: last.x, y: last.y, a: last.a, boost: last.boost, mult: last.mult };
}

const DRY_PIN = [{"time":10.933333333333353,"x":1025.7864286008746,"y":52.39275460998299,"a":7.86923389028134,"boost":0.7367996756887888,"mult":1.9158333333333644},{"time":16.999999999999677,"x":-550.9957720166949,"y":559.392923403932,"a":8.55800391889112,"boost":0.5729081371934801,"mult":3.9024999999999848}];

test("the dry path is bit-for-bit what it was before wet physics", () => {
  forceWeather(null);
  assert.deepEqual([fingerprint("2026-09-24"), fingerprint("2026-09-28")], DRY_PIN);
});

const METRICS = ["lapTime", "peakSpeed", "slideSec", "toGrip", "boostSec"];
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Drive seed dry or wet with the bootstrap controller, measure handling. */
function measure(seed, wet) {
  forceWeather(wet ? "wet" : "dry");
  loadTrackGeometry(seed);
  const { schedule } = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1 });
  const m = { lapTime: 0, peakSpeed: 0, slideSec: 0, toGrip: 0, boostSec: 0 };
  const toGrip = []; let releaseAt = -1, prev = 0, slid = false;
  const r = simulate(schedule, {
    laps: 1, maxTime: 60,
    observe(car, inp, flags, t) {
      m.peakSpeed = Math.max(m.peakSpeed, Math.hypot(car.vx, car.vy));
      if (car.boosting) m.boostSec += PHYSICS_DT;
      if (flags & SLIDING) { m.slideSec += PHYSICS_DT; slid = true; }
      if (inp === 0 && prev !== 0) releaseAt = slid ? t : -1;
      if (inp !== 0 && prev === 0) { slid = false; releaseAt = -1; }
      if (releaseAt >= 0 && car.drift < 0.13) { toGrip.push(t - releaseAt); releaseAt = -1; }
      prev = inp;
    },
  });
  forceWeather(null);
  m.lapTime = r.time; m.toGrip = mean(toGrip);
  return { m, off: r.off };
}

// Which way each metric must move to count as "wet, not just different":
// slower lap, lower top speed, longer slides, slower grip recovery. boostSec
// has no prescribed direction (more slide time can fill it either way), so
// it's measured but not part of the bar.
const WET_DIR = { lapTime: 1, peakSpeed: -1, slideSec: 1, toGrip: 1 };

test("wet moves a handling metric by at least 15% in the wet direction (the mod-feel bar)", () => {
  const seed = "2026-09-28";
  const dry = measure(seed, false).m, wet = measure(seed, true).m;
  const signed = k => WET_DIR[k] * (wet[k] / dry[k] - 1);
  console.log(METRICS.map(k => k + " " + dry[k].toFixed(2) + " → " + wet[k].toFixed(2)).join(" | "));
  assert.ok(Math.max(...Object.keys(WET_DIR).map(signed)) >= 0.15, "wet isn't slicker in a wet-consistent way");
});

test("loadTrackGeometry sets track.wet from the seed, and forceWeather overrides it", () => {
  let wetDay = null;
  for (let n = 0; n < 60 && !wetDay; n++) {
    const d = new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
    if (weatherFor(d) === "wet") wetDay = d;
  }
  assert.ok(wetDay, "a wet day exists in the first 60");
  loadTrackGeometry(wetDay); assert.equal(track.wet, true);
  loadTrackGeometry("2026-09-24"); assert.equal(track.wet, false);
  forceWeather("wet"); loadTrackGeometry("2026-09-24"); assert.equal(track.wet, true);
  forceWeather("dry"); loadTrackGeometry(wetDay); assert.equal(track.wet, false);
  forceWeather(null);
});

const { createInput } = await import(new URL("sim/schedule.js", root));
const { replay, trackFor } = await import(new URL("../worker/src/replay.js", import.meta.url));
const { integrate, createCar, placeCar } = await import(new URL("game/dynamics.js", root));
const { LAPS } = await import(new URL("config/tuning.js", root));

/** Record a full 3-lap run's input changes on the current track with the pure dynamics. */
function recordInputs() {
  const { schedule } = bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120 });
  const input = createInput(schedule);
  const car = createCar(); placeCar(car, track.samples[0]);
  const inputs = []; let last = 0, time = 0;
  for (let i = 0; i < 120 * 90 && car.lap <= LAPS; i++) {
    const inp = input(car.lap - 1 + car.prog);
    if (inp !== last) { inputs.push(i, inp); last = inp; }
    integrate(car, inp, PHYSICS_DT);
    time += PHYSICS_DT;
  }
  assert.ok(car.lap > LAPS, "the recorded run finishes");
  return { inputs, time };
}

test("the worker replays a wet run on a wet road to the identical time", () => {
  let wetDay = null;
  for (let n = 0; n < 60 && !wetDay; n++) {
    const d = new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
    if (weatherFor(d) === "wet") wetDay = d;
  }
  loadTrackGeometry(wetDay);
  const run = recordInputs();
  const r = replay(wetDay, run.inputs, { claimedTime: run.time });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.time, run.time);
});

test("trackFor restores the weather from its cache", () => {
  let wetDay = null;
  for (let n = 0; n < 60 && !wetDay; n++) {
    const d = new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
    if (weatherFor(d) === "wet") wetDay = d;
  }
  trackFor(wetDay); trackFor("2026-09-24"); trackFor(wetDay);   // second wetDay call is a cache hit
  assert.equal(track.wet, true);
  trackFor("2026-09-24");
  assert.equal(track.wet, false);
});

test("the line cache keeps wet and dry lines apart", async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const { lineKey } = await import(new URL("sim/line.js", root));
  assert.notEqual(lineKey("abc", true), lineKey("abc", false));
  assert.ok(lineKey("abc", true).startsWith("neondrift:tabc:line:v"));
  assert.ok(lineKey("abc", true).endsWith("-w"));
});

const { RECIPES, buildDriftTrack } = await import(new URL("track/layouts.js", root));
const { mulberry32, hashStr } = await import(new URL("core/random.js", root));
const { HALF_W, WET } = await import(new URL("config/tuning.js", root));

test("the car drives every family clean when wet, and a 3-lap race stays well under 90s", () => {
  // The line search's starting controllers (as in layouts.test.mjs): one must get round clean.
  const SETTINGS = [[4, 60, 12], [4, 120, 12], [6, 60, 12], [6, 120, 18], [4, 60, 18], [2, 0, 12]];
  const rows = [];
  for (const fam of Object.keys(RECIPES)) {
    const t = buildDriftTrack(mulberry32(hashStr(fam + ":drive")), fam);
    track.samples = t.S; track.length = t.length; track.halfW = HALF_W; track.wet = true;
    let best = null;
    for (const [edge, speed, hold] of SETTINGS) {
      const r = bootstrap({ hold, horizon: 120, edge, speed }).result;   // full 3 laps
      if (!best || r.off < best.off) best = r;
      if (r.off === 0) break;
    }
    rows.push(fam + " " + best.time.toFixed(1) + "s off " + best.off.toFixed(2));
    assert.equal(best.off, 0, fam + " leaves the road wet for " + best.off.toFixed(2) + "s");
    assert.ok(best.finished && best.time < 70, fam + " wet race " + best.time.toFixed(1) + "s: too close to the 90s cap");
  }
  track.wet = false;
  console.log("wet 3-lap bootstrap: " + rows.join(" | ") + "  WET " + JSON.stringify(WET));
});
