import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { chainReadout } = await import(new URL("game/chain.js", root));

const race = (o = {}) => ({ breakT: 0, lostMult: 1, keptMult: 1, ...o });
const near = (a, b) => Math.abs(a - b) < 1e-12;

test("at ×1 the chain is hidden", () => {
  const r = chainReadout(race(), { mult: 1.02 });
  assert.equal(r.state, "idle");
  assert.equal(r.alpha, 0);
  assert.equal(r.snap, false);
});

test("a building chain brightens and grows with the multiplier", () => {
  const r = chainReadout(race(), { mult: 2.5 });
  assert.equal(r.state, "chain");
  assert.equal(r.text, "×2.5");
  assert.equal(r.note, "");
  assert.equal(r.mult, 2.5);
  assert.ok(near(r.alpha, 0.7) && near(r.scale, 1.08));
  assert.equal(r.snap, false);
});

test("a break that keeps nothing reads LOST and snaps the meter", () => {
  const r = chainReadout(race({ breakT: 1, lostMult: 2.8 }), { mult: 1 });
  assert.equal(r.state, "broke");
  assert.equal(r.text, "×2.8");
  assert.equal(r.note, "LOST");
  assert.equal(r.mult, 2.8);
  assert.ok(near(r.alpha, 1) && near(r.scale, 1.14));
  assert.equal(r.snap, true);
});

test("a break that keeps part of the chain shows what's left", () => {
  const r = chainReadout(race({ breakT: 0.5, lostMult: 3.4, keptMult: 1.9 }), { mult: 1.9 });
  assert.equal(r.note, "→ ×1.9");
  assert.ok(near(r.alpha, 0.9));
  assert.equal(r.snap, false);
});
