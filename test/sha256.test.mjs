import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { sha256Hex, sha256HexPure } = await import(new URL("../js/core/sha256.js", import.meta.url));
const ref = s => createHash("sha256").update(s, "utf8").digest("hex");

const cases = [
  "", "abc", "0123456789abcdef0123456789abcdef",
  "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(1000),
  "héllo wörld — ünïcödé ✓", "😀 emoji pairs",
];

test("the pure implementation matches node's sha256 across block boundaries and unicode", () => {
  for (const s of cases) assert.equal(sha256HexPure(s), ref(s), JSON.stringify(s.slice(0, 20)));
});

test("sha256Hex resolves to the same digest (subtle or pure)", async () => {
  for (const s of cases) assert.equal(await sha256Hex(s), ref(s));
});

test("the test secret hashes to the id the worker keys rows on", async () => {
  assert.equal(await sha256Hex("0123456789abcdef0123456789abcdef"), "3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9");
});
