// The track builders' math must give the same bits in every engine, and must
// keep building the ids every stored ghost and leaderboard row is keyed on.
// Firefox built 2026-09-28 as 1G0U22H while Chrome and the worker built
// 112VFL5, because its Math.sin/cos/hypot round differently (core/fmath.js).
globalThis.location = { search: "" };
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../js/", import.meta.url);
const F = await import(new URL("core/fmath.js", root));
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { stageSeed, stageShape } = await import(new URL("run/stages.js", root));
const { mulberry32 } = await import(new URL("core/random.js", root));

const day = n => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
const fnv = strs => { let h = 2166136261; for (const s of strs) for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); };
const idOf = (seed, shape) => { loadTrackGeometry(seed, shape); return track.id; };

test("the daily that split Chrome and Firefox builds Chrome's track", () => {
  assert.equal(idOf("2026-09-28"), "112vfl5");
});

test("track ids are unchanged: every day from 2026-09-01 for 400 days, stages, live rounds, custom seeds", () => {
  // Hashes of the ids as they built on Math in V8 before the builders moved to fmath.
  const days = [...Array(400)].map((_, i) => idOf(day(i)));
  assert.equal(fnv(days), "b4e3f78");
  const stages = [];
  for (let d = 18; d < 48; d++) for (let n = 1; n <= 10; n++) stages.push(idOf(stageSeed(day(d), n), stageShape(n)));
  assert.equal(fnv(stages), "38baad6b");
  const live = [...Array(300)].map((_, r) => idOf("live-" + r));
  assert.equal(fnv(live), "63bd5bee");
  const custom = ["foo", "hello", "rnd-abc123", "2026-12-25x", "test"].map(s => idOf(s));
  assert.equal(fnv(custom), "eadafbc9");
});

test("fmath's own bits are pinned, so an edit to it can't quietly move tracks", () => {
  const rng = mulberry32(7), out = [];
  for (let i = 0; i < 20000; i++) {
    const a = (rng() - 0.5) * 120, y = (rng() - 0.5) * 8000, x = (rng() - 0.5) * 8000, c = rng() * 2 - 1;
    out.push(F.sin(a), F.cos(a), F.atan2(y, x), F.acos(c), F.hypot(y, x));
  }
  assert.equal(fnv(out.map(String)), "c609d75e");
});

test("hypot is V8's Math.hypot bit for bit", { skip: !process.versions.v8 }, () => {
  const rng = mulberry32(11);
  for (let i = 0; i < 200000; i++) {
    const a = (rng() - 0.5) * 9000, b = (rng() - 0.5) * 9000;
    assert.equal(F.hypot(a, b), Math.hypot(a, b));
  }
});

test("fmath handles the edges like Math", () => {
  for (const [f, args] of [["sin", [0]], ["sin", [-0]], ["cos", [0]], ["sin", [NaN]], ["cos", [Infinity]],
    ["acos", [1]], ["acos", [-1]], ["acos", [2]], ["atan2", [0, -1]], ["atan2", [-0, -1]], ["atan2", [1, 0]],
    ["atan2", [0, 0]], ["atan2", [Infinity, 1]], ["hypot", [0, 0]], ["hypot", [Infinity, NaN]], ["hypot", [3, 4]]])
    assert.ok(Object.is(F[f](...args), Math[f](...args)), `${f}(${args})`);
  for (let x = -40; x <= 40; x += 0.37) {
    assert.ok(Math.abs(F.sin(x) - Math.sin(x)) < 1e-15, `sin ${x}`);
    assert.ok(Math.abs(F.cos(x) - Math.cos(x)) < 1e-15, `cos ${x}`);
  }
});

test("the track builders call no engine-rounded Math function", () => {
  for (const f of ["track/generator.js", "track/layouts.js"]) {
    const src = readFileSync(new URL(f, root), "utf8");
    assert.doesNotMatch(src, /Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|pow|exp|log|cbrt|sinh|cosh|tanh)\(/, f);
  }
});
