import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: "", hostname: "example.test", href: "https://example.test/neondrift/index.html?nocache=1" };
const { challengeUrl, pickChallenger } = await import(new URL("../js/net/leaderboard.js", import.meta.url));

const ME = "a".repeat(64), THEM = "b".repeat(64);

test("challengeUrl carries the seed and the player id and keeps the page", () => {
  const u = new URL(challengeUrl("2026-09-20", THEM));
  assert.equal(u.origin + u.pathname, "https://example.test/neondrift/index.html");
  assert.equal(u.searchParams.get("seed"), "2026-09-20");
  assert.equal(u.searchParams.get("rival"), THEM);
  assert.equal(u.searchParams.get("nocache"), null, "unrelated params are dropped so the link is clean");
});

test("challengeUrl works for any seed string", () => {
  assert.equal(new URL(challengeUrl("rnd-x1y2", THEM)).searchParams.get("seed"), "rnd-x1y2");
});

test("pickChallenger accepts a well-formed id that isn't your own", () => {
  assert.equal(pickChallenger(THEM, ME), THEM);
  assert.equal(pickChallenger(THEM, null), THEM, "no identity yet: still a valid challenge");
  assert.equal(pickChallenger(ME, ME), null, "your own link challenges nobody");
  assert.equal(pickChallenger("short", ME), null);
  assert.equal(pickChallenger("B".repeat(64), ME), null, "ids are lowercase hex");
  assert.equal(pickChallenger(null, ME), null);
  assert.equal(pickChallenger("", ME), null);
});
