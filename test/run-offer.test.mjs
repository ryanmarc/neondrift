import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { MODS, byId } = await import(new URL("run/mods.js", root));
const { offerFor, OFFER_SIZE } = await import(new URL("run/offer.js", root));

test("same day, stage and picks give the same offer", () => {
  assert.deepEqual(offerFor("2026-09-22", 3, ["loose"]), offerFor("2026-09-22", 3, ["loose"]));
  assert.notDeepEqual(offerFor("2026-09-22", 3, []), offerFor("2026-09-23", 3, []));
  assert.notDeepEqual(offerFor("2026-09-22", 3, []), offerFor("2026-09-22", 4, []));
});

test("three distinct real mods, never skip", () => {
  for (let s = 1; s <= 20; s++) {
    const o = offerFor("2026-09-22", s, []);
    assert.equal(o.length, OFFER_SIZE);
    assert.equal(new Set(o).size, OFFER_SIZE);
    for (const id of o) assert.ok(byId.has(id), id);
  }
});

test("a mod at its max is never offered", () => {
  for (let s = 1; s <= 50; s++) {
    assert.ok(!offerFor("2026-09-22", s, ["angle"]).includes("angle"));
    assert.ok(!offerFor("2026-09-22", s, ["loose", "loose", "loose"]).includes("loose"));
    assert.ok(offerFor("2026-09-22", s, ["loose", "loose"]).length === OFFER_SIZE);
  }
});

test("the offer shrinks when fewer mods remain", () => {
  const all = MODS.flatMap(m => Array(m.max).fill(m.id));
  const keepTwo = all.filter(id => id !== "angle" && id !== "roller");
  assert.deepEqual(offerFor("2026-09-22", 9, keepTwo).sort(), ["angle", "roller"]);
  assert.deepEqual(offerFor("2026-09-22", 9, all), []);
});

test("held mods are offered more often", () => {
  let withHeld = 0, without = 0;
  for (let s = 1; s <= 400; s++) {
    if (offerFor("weight-" + s, 1, ["turbo"]).includes("turbo")) withHeld++;
    if (offerFor("weight-" + s, 1, []).includes("turbo")) without++;
  }
  assert.ok(withHeld > without * 1.4, "held " + withHeld + " vs " + without);
});
