// The rain is a fixed pool: sized once from the viewport, recycled forever,
// never grown per frame.
import { test } from "node:test";
import assert from "node:assert/strict";

const { createRain, rainCount, stepRain } = await import(new URL("../js/render/rain.js", import.meta.url));

test("the pool scales with the viewport and is capped", () => {
  assert.ok(rainCount(390, 844) < rainCount(1920, 1080));
  assert.ok(rainCount(390, 844) >= 80);
  assert.ok(rainCount(3840, 2160) <= 250);
});

test("stepping recycles drops inside the viewport and never reallocates", () => {
  const r = createRain(120);
  const buf = r.drops;
  for (let i = 0; i < 2000; i++) stepRain(r, 800, 600, 1 / 60, 300, -200);
  assert.equal(r.drops, buf, "same buffer");
  for (let i = 0; i < 120; i++) {
    const x = r.drops[i * 3], y = r.drops[i * 3 + 1];
    assert.ok(x >= -100 && x <= 900 && y >= -100 && y <= 700, "drop " + i + " at " + x + "," + y);
  }
});
