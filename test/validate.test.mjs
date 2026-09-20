import { test } from "node:test";
import assert from "node:assert/strict";
const v = await import(new URL("../worker/src/validate.js", import.meta.url));

test("cleanName trims, collapses spaces and enforces 2–16 chars", () => {
  assert.equal(v.cleanName("  Ryan   E. "), "Ryan E.");
  assert.equal(v.cleanName("R"), null);
  assert.equal(v.cleanName("a".repeat(17)), null);
  assert.equal(v.cleanName("a".repeat(16)), "a".repeat(16));
  assert.equal(v.cleanName("Ry<script>"), null);
  assert.equal(v.cleanName("Drift-King_99!?"), "Drift-King_99!?");
  assert.equal(v.cleanName(42), null);
});

test("secrets are 32 lowercase hex characters", () => {
  assert.equal(v.validSecret("0123456789abcdef0123456789abcdef"), true);
  assert.equal(v.validSecret("0123456789ABCDEF0123456789abcdef"), false);
  assert.equal(v.validSecret("abc"), false);
});

test("seeds and track ids are bounded and plain", () => {
  assert.equal(v.validSeed("2026-09-20"), true);
  assert.equal(v.validSeed("rnd-abc123"), true);
  assert.equal(v.validSeed("x".repeat(65)), false);
  assert.equal(v.validSeed("bad\nseed"), false);
  assert.equal(v.validTrackId("7b7u93"), true);
  assert.equal(v.validTrackId("7B7U93"), false);
  assert.equal(v.validTrackId(""), false);
});

test("inputs are pairs of increasing steps and -1/0/1", () => {
  assert.equal(v.validInputs([0, 1, 40, 0, 90, -1]), true);
  assert.equal(v.validInputs([]), true);
  assert.equal(v.validInputs([0, 1, 40]), false);              // odd length
  assert.equal(v.validInputs([40, 1, 40, 0]), false);          // not increasing
  assert.equal(v.validInputs([0, 2]), false);                  // bad input value
  assert.equal(v.validInputs([0.5, 1]), false);                // non-integer step
  assert.equal(v.validInputs(new Array(4002).fill(0).map((_, i) => i % 2 ? 0 : i)), false);
});

test("ghosts are finite numbers in groups of four, bounded", () => {
  assert.equal(v.validGhost([1, 2, 0.5, 0.01]), true);
  assert.equal(v.validGhost([1, 2, 3]), false);
  assert.equal(v.validGhost([1, 2, Infinity, 0]), false);
  assert.equal(v.validGhost(new Array(9004).fill(0)), false);
});

test("times and codes", () => {
  assert.equal(v.validTime(41.2), true);
  assert.equal(v.validTime(0), false);
  assert.equal(v.validTime(76), false);
  assert.equal(v.validCode("ABC234"), true);
  assert.equal(v.validCode("abc234"), false);
  assert.equal(v.validCode("ABC01O"), false);
});
