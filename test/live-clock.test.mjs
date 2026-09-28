// The live round clock (js/live/clock.js) and the seeds it names. Every room
// and client derives the round from the wall clock, so these are the rules
// both sides must agree on.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const C = await import(new URL("live/clock.js", root));
const { FAMILIES, styleFor } = await import(new URL("track/styles.js", root));
const { weatherFor } = await import(new URL("track/weather.js", root));

test("round slots are 195s from the epoch, 180 racing then 15 results", () => {
  assert.equal(C.SLOT_MS, 195000);
  assert.equal(C.RACING_MS, 180000);
  const s = C.roundStart(10);
  assert.equal(C.roundAt(s), 10);
  assert.equal(C.roundAt(s - 1), 9);
  assert.equal(C.roundAt(s + C.SLOT_MS - 1), 10);
  assert.deepEqual(C.phaseAt(s), { round: 10, racing: true, left: 180 });
  assert.deepEqual(C.phaseAt(s + 179999), { round: 10, racing: true, left: 0.001 });
  assert.deepEqual(C.phaseAt(s + 180000), { round: 10, racing: false, left: 15 });
  assert.equal(C.seedFor(10), "live-10");
});

test("an attempt is open until racing end plus the grace, for its own round only", () => {
  const s = C.roundStart(7);
  assert.equal(C.open(7, s + 1000), true);
  assert.equal(C.open(7, s + C.RACING_MS + C.GRACE_MS - 1), true);
  assert.equal(C.open(7, s + C.RACING_MS + C.GRACE_MS), false);
  assert.equal(C.open(6, s + 1000), false);
  assert.equal(C.open(8, s + 1000), false);
});

test("the client's entry action: a new round loads its map; racing drives; results wait", () => {
  const s = C.roundStart(50);
  assert.equal(C.entryAction(49, s + 1000), "load");
  assert.equal(C.entryAction(-1, s + 1000), "load");
  assert.equal(C.entryAction(50, s + 1000), "drive");
  assert.equal(C.entryAction(50, s + C.RACING_MS), "wait", "joining in the results phase never starts a car");
  assert.equal(C.entryAction(50, s + C.RACING_MS + 14000), "wait");
  assert.equal(C.open(49, s + 1000), false, "a lap finished on an old map (a hidden tab) is never sent");
});

test("live seeds are drift layouts that never repeat a family back to back", () => {
  let prev = null;
  for (let n = 0; n < 600; n++) {
    const f = styleFor("live-" + n);
    assert.ok(FAMILIES.includes(f), "live-" + n + " → " + f);
    assert.notEqual(f, prev, "live-" + n + " repeats " + f);
    prev = f;
  }
  for (let b = 0; b < 100; b++) {
    const block = new Set();
    for (let k = 0; k < 6; k++) block.add(styleFor("live-" + (b * 6 + k)));
    assert.equal(block.size, 6, "block " + b);
  }
});

test("malformed live seeds stay on the legacy generator", () => {
  for (const s of ["live-", "live--1", "live-1.5", "live-01", "live-abc", "live"]) assert.equal(styleFor(s), null, s);
});

test("live seeds roll weather about one in five", () => {
  let wet = 0;
  for (let n = 0; n < 1000; n++) if (weatherFor("live-" + n) === "wet") wet++;
  assert.ok(wet > 150 && wet < 250, "wet " + wet + " of 1000");
  assert.equal(weatherFor("live-abc"), "dry");
});
