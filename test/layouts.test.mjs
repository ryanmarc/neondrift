// Drift layouts (track/layouts.js) and which seed gets which (track/styles.js).
// The bar: past days never change, the daily and the run's stages walk the
// families without repeats, and every family builds a closed, clear lap in the
// legacy length band that the car can actually drive.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { CUTOVER, FAMILIES, styleFor } = await import(new URL("track/styles.js", root));
const { LAP, RECIPES, DAILY_CORNERS, buildDriftTrack, clear, drivableR } = await import(new URL("track/layouts.js", root));
const { cornerCount } = await import(new URL("track/generator.js", root));
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { bootstrap } = await import(new URL("sim/simulate.js", root));
const { stageShape, stageSeed } = await import(new URL("run/stages.js", root));
const { mulberry32, hashStr } = await import(new URL("core/random.js", root));
const { HALF_W } = await import(new URL("config/tuning.js", root));

const rngFor = s => mulberry32(hashStr(s));
const day = n => new Date(Date.UTC(2026, 8, 27 + n)).toISOString().slice(0, 10);   // CUTOVER + n days

test("the cutover is where the dailies begin", () => assert.equal(CUTOVER, day(0)));

test("past days, their run stages and custom seeds keep the harmonic generator", () => {
  for (const s of ["2026-09-19", "2026-09-26", "2026-09-26#run4", "abc", "record-test", "2026-02-30"]) {
    assert.equal(styleFor(s), null, s);
  }
  loadTrackGeometry("2026-09-26");
  assert.equal(track.style, "classic");
});

test("from the cutover every daily, stage and ?seed=random is a drift layout", () => {
  for (const s of [day(0), day(40), day(0) + "#run1", day(3) + "#run12", "rnd-k2j4x9"]) {
    assert.ok(FAMILIES.includes(styleFor(s)), s + " → " + styleFor(s));
  }
});

test("the daily walk: never the same family two days running, all six in every block of six", () => {
  const seq = Array.from({ length: 366 }, (_, n) => styleFor(day(n)));
  for (let n = 1; n < seq.length; n++) assert.notEqual(seq[n], seq[n - 1], day(n) + " repeats " + seq[n]);
  for (let b = 0; b + 6 <= seq.length; b += 6) assert.equal(new Set(seq.slice(b, b + 6)).size, 6, "block at " + day(b));
});

test("a run's stages never repeat back to back, and stage 1 is never the daily's family", () => {
  for (let n = 0; n < 60; n++) {
    const d = day(n), stages = Array.from({ length: 14 }, (_, k) => styleFor(stageSeed(d, k + 1)));
    assert.notEqual(stages[0], styleFor(d), d + " opens on the daily's family");
    for (let k = 1; k < stages.length; k++) assert.notEqual(stages[k], stages[k - 1], d + " stage " + (k + 1));
    assert.equal(new Set(stages.slice(0, 6)).size, 6, d + ": the first six stages show every family");
  }
});

test("pinned: the first drift-layout days keep their tracks", () => {
  // Like run-ramp's pin on the harmonic generator: once these days are live,
  // their ids key ghosts and leaderboard rows. If this fails, the drift
  // generator's output moved — bump CUTOVER instead of changing a live day.
  const pins = { "2026-09-27": "4zodk0", "2026-09-28": "112vfl5" };
  for (const [seed, id] of Object.entries(pins)) { loadTrackGeometry(seed); assert.equal(track.id, id, seed); }
});

test("every family builds a closed, clear, drivable lap in its length band, with no fallback", () => {
  for (const fam of Object.keys(RECIPES)) {
    for (let i = 0; i < 40; i++) {
      const t = buildDriftTrack(rngFor(fam + ":" + i), fam);
      const tag = fam + " #" + i;
      assert.equal(t.family, fam, tag + " fell back to the harmonic generator");
      assert.ok(t.minR > 190, tag + " minR " + t.minR.toFixed(0));
      const [lo, hi] = LAP[fam];
      // the band is set on the segments; the closure's small shear moves the
      // sampled length slightly, and each extra the daily's corner target adds
      // earns 6–12% more lap (two extras at most at the daily's target)
      assert.ok(t.length >= lo * 0.93 * 0.98 && t.length <= hi * 1.1 * 1.24 * 1.02, tag + " length " + t.length.toFixed(0));
      assert.ok(t.length <= 13500, tag + " length " + t.length.toFixed(0) + ": too long for a three-lap race");
      assert.ok(clear(t.S), tag + " touches itself");
      assert.ok(cornerCount(t.S) >= 4, tag + " has " + cornerCount(t.S) + " corners");
      // closed: the last sample leads back into the first at the usual spacing
      const a = t.S[t.S.length - 1], b = t.S[0];
      assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - t.length / t.S.length) < 0.5, tag + " seam");
      // every race starts on a straight
      let c = 0; for (let k = -5; k <= 5; k++) c += Math.abs(t.S[(k + t.S.length) % t.S.length].curv);
      assert.ok(c < 1e-3, tag + " starts in a corner");
    }
  }
});

test("every lap runs clockwise on screen, like the harmonic generator's", () => {
  // canvas y points down, so a lap whose heading turns +360° is clockwise
  const turns = () => track.samples.reduce((a, s) => a + s.curv, 0) / (2 * Math.PI);
  for (let n = 0; n < 24; n++) {
    for (const seed of [day(n), stageSeed(day(n), 1 + n % 12), "2026-09-" + String(10 + n % 20).padStart(2, "0")]) {
      loadTrackGeometry(seed, seed.includes("#") ? stageShape(1 + n % 12) : undefined);
      assert.ok(Math.abs(turns() - 1) < 1e-6, seed + " (" + track.style + ") turns " + turns().toFixed(3));
    }
  }
});

test("the daily is as busy as a late gauntlet stage", () => {
  // entry, technical, touge and flow always reach the target; bank and loop
  // are best-effort and still average close to it
  for (const fam of Object.keys(RECIPES)) {
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += cornerCount(buildDriftTrack(rngFor(fam + ":busy" + i), fam).S);
    assert.ok(sum / 20 >= DAILY_CORNERS - 1.2, fam + " averages " + (sum / 20).toFixed(1) + " corners");
  }
});

test("technical's extra corners are esses, loop's are reverse hairpins", () => {
  // count direction changes between corners: esses and hairpin lobes both
  // alternate, so each extra adds reversals, not same-way corners
  const reversals = S => {
    const N = S.length, sm = i => { let c = 0; for (let k = -8; k <= 8; k++) c += S[((i + k) % N + N) % N].curv; return c / 17; };
    let n = 0, prev = 0;
    for (let i = 0; i < N; i++) { const c = sm(i), sg = Math.abs(c) > 12 / 520 ? Math.sign(c) : 0; if (sg && prev && sg !== prev) n++; if (sg) prev = sg; }
    return n;
  };
  for (const [fam, lo, hi] of [["technical", 4, 9], ["loop", 4, 8]]) {
    let a = 0, b = 0;
    for (let i = 0; i < 10; i++) {
      a += reversals(buildDriftTrack(rngFor(fam + ":x" + i), fam, { minR: 185, corners: lo }).S);
      b += reversals(buildDriftTrack(rngFor(fam + ":x" + i), fam, { minR: 185, corners: hi }).S);
    }
    assert.ok(b > a, fam + ": more corners should mean more switchbacks (" + a / 10 + " → " + b / 10 + ")");
  }
});

test("tracks within a family are different shapes, not one shape rotated", () => {
  // Turning-function distance: heading against normalised distance along the
  // lap, minus the lap's steady 360°, compared at the best start offset and
  // heading offset, so rotation and start line don't count. Measured when
  // the recipes were fixed sequences: 0.17–0.24 for most families (the same
  // outline redrawn); as grammars, 0.34–0.58, against ~0.39 for the harmonic
  // generator and ~0.57 between different families.
  const K = 120;
  const profile = S => {
    const th = [0]; for (let i = 1; i < S.length; i++) th.push(th[i - 1] + S[i - 1].curv);
    return Array.from({ length: K }, (_, k) => th[Math.floor(k / K * S.length)] - 2 * Math.PI * k / K);
  };
  const dist = (a, b) => {
    let best = Infinity;
    for (let s = 0; s < K; s++) {
      let m = 0; for (let k = 0; k < K; k++) m += a[k] - b[(k + s) % K]; m /= K;
      let e = 0; for (let k = 0; k < K; k++) e += (a[k] - b[(k + s) % K] - m) ** 2;
      best = Math.min(best, Math.sqrt(e / K));
    }
    return best;
  };
  for (const fam of Object.keys(RECIPES)) {
    const P = Array.from({ length: 8 }, (_, i) => profile(buildDriftTrack(rngFor(fam + ":shape" + i), fam).S));
    let sum = 0, n = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { sum += dist(P[i], P[j]); n++; }
    assert.ok(sum / n > 0.3, fam + " tracks are too alike: mean distance " + (sum / n).toFixed(3));
  }
});

test("every daily is worth drifting: plenty of turning, several turn-backs", () => {
  // A lap must turn 360° just to close. Before this rule a flow daily could
  // turn 445° with two direction changes and barely need a slide; the
  // harmonic generator's calmest turns ~484°. Now every family's calmest
  // daily turns well past that.
  const turning = S => {
    const N = S.length, sm = i => { let c = 0; for (let k = -8; k <= 8; k++) c += S[((i + k) % N + N) % N].curv; return c / 17; };
    let abs = 0, rev = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      abs += Math.abs(S[i].curv);
      const c = sm(i), sg = Math.abs(c) > 12 / 700 ? Math.sign(c) : 0;
      if (sg && prev && sg !== prev) rev++;
      if (sg) prev = sg;
    }
    return { deg: abs * 180 / Math.PI, rev };
  };
  for (const fam of Object.keys(RECIPES)) {
    for (let i = 0; i < 20; i++) {
      const { deg, rev } = turning(buildDriftTrack(rngFor(fam + ":busy" + i), fam).S);
      assert.ok(deg > 640, fam + " #" + i + " turns only " + deg.toFixed(0) + "°");
      assert.ok(rev >= 3, fam + " #" + i + " has only " + rev + " direction changes");
    }
  }
});

test("drivableR: a hairpin needs ~400px, a right angle almost nothing", () => {
  assert.ok(drivableR(Math.PI) >= 400 && drivableR(Math.PI) <= 480);
  assert.ok(drivableR(Math.PI / 2) < 220);
  assert.ok(drivableR(2.4) > drivableR(2.0), "tighter the more it turns");
});

test("layouts are deterministic, and lapScale scales the accepted lap", () => {
  const a = buildDriftTrack(rngFor("det"), "touge"), b = buildDriftTrack(rngFor("det"), "touge");
  assert.equal(a.S.length, b.S.length);
  assert.equal(a.S[123].x, b.S[123].x);
  const wide = buildDriftTrack(rngFor("det"), "touge", { lapScale: 1.2 });
  assert.ok(Math.abs(wide.length / a.length - 1.2) < 0.01, "length " + wide.length / a.length);
  assert.ok(wide.minR > a.minR * 1.15, "every radius grows");
});

test("the run's stages build drift layouts at every step of the ramp", () => {
  for (const d of [day(0), day(7)]) {
    for (let n = 1; n <= 12; n++) {
      loadTrackGeometry(stageSeed(d, n), stageShape(n));
      const tag = stageSeed(d, n);
      assert.ok(FAMILIES.includes(track.style), tag + " is " + track.style);
      assert.ok(cornerCount(track.samples) >= Math.min(stageShape(n).corners, 5), tag + " has " + cornerCount(track.samples) + " corners");
      assert.ok(clear(track.samples), tag + " touches itself");
    }
  }
});

test("the car can drive every family without leaving the road", () => {
  // The optimiser's starting controllers; one of them must get round clean,
  // or the optimal line can't be feasible and a fair lap isn't either.
  const SETTINGS = [[4, 60, 12], [4, 120, 12], [6, 60, 12], [6, 120, 18], [4, 60, 18], [2, 0, 12]];
  for (const fam of Object.keys(RECIPES)) {
    const t = buildDriftTrack(rngFor(fam + ":drive"), fam);
    track.samples = t.S; track.length = t.length; track.halfW = HALF_W;
    let best = null;
    for (const [edge, speed, hold] of SETTINGS) {
      const r = bootstrap({ hold, horizon: 120, edge, speed, laps: 1 }).result;
      if (!best || r.off < best.off) best = r;
      if (r.off === 0) break;
    }
    assert.equal(best.off, 0, fam + " leaves the road for " + best.off.toFixed(2) + "s");
    assert.ok(best.time > 9 && best.time < 19, fam + " laps in " + best.time.toFixed(1) + "s");
  }
});
