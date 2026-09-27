// Which tracks are wet (track/weather.js). The bar: nothing before the
// cutover ever changes, about one track in five is wet after it, and a run's
// stages roll independently of their daily and of each other.
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { WEATHER_CUTOVER, weatherFor } = await import(new URL("track/weather.js", root));
const { CUTOVER } = await import(new URL("track/styles.js", root));

const day = n => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);   // WEATHER_CUTOVER + n days

test("the weather cutover is 2026-10-01, after the layout cutover", () => {
  assert.equal(WEATHER_CUTOVER, "2026-10-01");
  assert.equal(day(0), WEATHER_CUTOVER);
  assert.ok(WEATHER_CUTOVER > CUTOVER);
});

test("days before the cutover, their stages and custom seeds are always dry", () => {
  for (let n = 1; n <= 400; n++) {
    const d = day(-n);
    assert.equal(weatherFor(d), "dry", d);
    for (let s = 1; s <= 10; s++) assert.equal(weatherFor(d + "#run" + s), "dry", d + "#run" + s);
  }
  for (const s of ["abc", "record-test", "2026-02-30", "2026-13-01", "", "#run3"]) assert.equal(weatherFor(s), "dry", s);
});

test("about one daily in five is wet from the cutover", () => {
  let wet = 0;
  for (let n = 0; n < 1000; n++) if (weatherFor(day(n)) === "wet") wet++;
  assert.ok(wet >= 150 && wet <= 250, wet + " wet days in 1000");
});

test("about one stage in five is wet, and stages roll independently of their daily", () => {
  let wet = 0, sameAsDaily = 0;
  for (let n = 0; n < 100; n++) {
    const d = day(n);
    for (let s = 1; s <= 10; s++) {
      const w = weatherFor(d + "#run" + s);
      if (w === "wet") wet++;
      if (w === weatherFor(d)) sameAsDaily++;
    }
  }
  assert.ok(wet >= 150 && wet <= 250, wet + " wet stages in 1000");
  assert.ok(sameAsDaily < 900, "stage weather is not just the daily's");
});

test("?seed=random tracks roll too", () => {
  let wet = 0;
  for (let i = 0; i < 1000; i++) if (weatherFor("rnd-" + i.toString(36)) === "wet") wet++;
  assert.ok(wet >= 150 && wet <= 250, wet);
});

test("pure and deterministic", () => {
  for (let n = 0; n < 50; n++) assert.equal(weatherFor(day(n)), weatherFor(day(n)));
});
