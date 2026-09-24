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
  assert.deepEqual(offerFor("2026-09-22", 9, keepTwo), ["angle", "roller"]);   // slot one is the car card
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

const CAR = new Set(["car", "character"]);
const kindOf = id => byId.get(id).kind;

test("slot one is always a car or character card while any remain", () => {
  for (let s = 1; s <= 40; s++) for (const day of ["2026-09-24", "2026-10-01"]) {
    assert.ok(CAR.has(kindOf(offerFor(day, s, [])[0])), day + " " + s);
  }
});

test("with every car and character card maxed, the offer still fills three from the rest", () => {
  const carsMaxed = MODS.filter(m => CAR.has(m.kind)).flatMap(m => Array(m.max).fill(m.id));
  for (let s = 1; s <= 20; s++) {
    const o = offerFor("2026-09-24", s, carsMaxed);
    assert.equal(o.length, OFFER_SIZE);
    for (const id of o) assert.ok(!CAR.has(kindOf(id)), id);
  }
});

test("pure cards come up about half as often as a one-max trade card", () => {
  let pure = 0, trade = 0;
  for (let s = 1; s <= 600; s++) {
    const o = offerFor("weight-" + s, 1, []);
    if (o.includes("kickstart")) pure++;
    if (o.includes("roller")) trade++;
  }
  assert.ok(pure < trade * 0.75 && pure > trade * 0.3, "pure " + pure + " vs trade " + trade);
});

test("character cards are weighted up until one is held", () => {
  let none = 0, some = 0;
  for (let s = 1; s <= 600; s++) {
    if (offerFor("weight-" + s, 1, []).includes("boat")) none++;
    if (offerFor("weight-" + s, 1, ["fishtail"]).includes("boat")) some++;
  }
  assert.ok(none > some * 1.3, "unheld " + none + " vs held " + some);
});
