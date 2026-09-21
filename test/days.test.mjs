import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
const p = await import(new URL("../js/config/params.js", import.meta.url));

test("isDateSeed accepts only real YYYY-MM-DD dates", () => {
  assert.equal(p.isDateSeed("2026-09-21"), true);
  assert.equal(p.isDateSeed("2024-02-29"), true);     // leap day
  assert.equal(p.isDateSeed("2026-02-30"), false);    // not a real day
  assert.equal(p.isDateSeed("2026-13-01"), false);
  assert.equal(p.isDateSeed("rnd-abc123"), false);
  assert.equal(p.isDateSeed("random"), false);
  assert.equal(p.isDateSeed(""), false);
  assert.equal(p.isDateSeed("2026-9-1"), false);      // must be zero-padded like todayUtc
});

test("shiftDate moves whole UTC days across month and year ends", () => {
  assert.equal(p.shiftDate("2026-09-21", -1), "2026-09-20");
  assert.equal(p.shiftDate("2026-09-21", 0), "2026-09-21");
  assert.equal(p.shiftDate("2026-10-01", -1), "2026-09-30");
  assert.equal(p.shiftDate("2027-01-01", -1), "2026-12-31");
  assert.equal(p.shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(p.shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(p.shiftDate("2026-09-21", -30), "2026-08-22");
});

test("describeDay names a date seed relative to today", () => {
  const today = "2026-09-21";
  assert.equal(p.describeDay("2026-09-21", today), "today");
  assert.equal(p.describeDay("2026-09-20", today), "yesterday");
  assert.equal(p.describeDay("2026-09-19", today), "2 days ago");
  assert.equal(p.describeDay("2026-08-22", today), "30 days ago");
  assert.equal(p.describeDay("2026-09-22", today), "tomorrow");
  assert.equal(p.describeDay("2026-09-25", today), "in 4 days");
  assert.equal(p.describeDay("rnd-abc123", today), null);
});

test("FIRST_DAY is a date seed and not after today", () => {
  assert.equal(p.isDateSeed(p.FIRST_DAY), true);
  assert.ok(p.FIRST_DAY <= p.TODAY);
});
