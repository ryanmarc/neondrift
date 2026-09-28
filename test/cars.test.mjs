import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { CARS, carById, drawCarShape, garage } = await import(new URL("render/cars.js", root));
const { CAR_SCALE } = await import(new URL("config/tuning.js", root));

// A 2D context that records every call and accepts every property. Path calls
// also collect their points (curve control points included, which bound the curve).
function stubContext() {
  const calls = [], pts = [];
  const props = {};
  const track = {
    moveTo: (x, y) => pts.push([x, y]),
    lineTo: (x, y) => pts.push([x, y]),
    quadraticCurveTo: (cx, cy, x, y) => pts.push([cx, cy], [x, y]),
    rect: (x, y, w, h) => pts.push([x, y], [x + w, y + h]),
  };
  const c = new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { calls.push(k); if (track[k]) track[k](...a); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { c, calls, pts };
}

test("the lineup: nine cars, unique ids, Neon first", () => {
  assert.equal(CARS.length, 9);
  assert.equal(CARS[0].id, "neon");
  assert.equal(new Set(CARS.map(k => k.id)).size, CARS.length);
  for (const k of CARS) {
    assert.equal(typeof k.name, "string", k.id);
    assert.ok(k.name.length > 0, k.id);
    assert.equal(typeof k.chassis, "string", k.id);
    assert.ok(Number.isFinite(k.front) && Number.isFinite(k.rear) && k.front > k.rear, k.id);
    assert.equal(typeof k.body, "function", k.id);
    assert.equal(typeof k.detail, "function", k.id);
  }
});

test("an unknown, missing or junk id is Neon", () => {
  assert.equal(carById("e30").id, "e30");
  for (const id of ["nope", undefined, null, "", "E30", "__proto__", "constructor"]) {
    assert.equal(carById(id).id, "neon", String(id));
  }
});

test("the choice starts on Neon", () => {
  assert.equal(garage.car, "neon");
});

test("every body is a closed outline of a car's size, matching its front and rear", () => {
  for (const k of CARS) {
    const { c, calls, pts } = stubContext();
    k.body(c);
    assert.ok(calls.includes("closePath"), k.id + " closes its outline");
    const xs = pts.map(p => p[0]), ys = pts.map(p => Math.abs(p[1]));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    assert.ok(maxX - minX >= 38 && maxX - minX <= 54, `${k.id} length ${maxX - minX}`);
    assert.ok(Math.max(...ys) <= 12, `${k.id} half-width ${Math.max(...ys)}`);
    assert.ok(Math.abs(maxX - k.front) <= 1, `${k.id} front ${k.front} vs ${maxX}`);
    assert.ok(Math.abs(minX - k.rear) <= 1, `${k.id} rear ${k.rear} vs ${minX}`);
    for (const [x, y] of pts) assert.ok(Number.isFinite(x) && Number.isFinite(y), k.id + " finite points");
  }
});

test("every car's details draw without throwing", () => {
  for (const k of CARS) {
    const { c, calls } = stubContext();
    k.detail(c);
    assert.ok(calls.length > 0, k.id);
  }
});

test("drawCarShape glows the body, then draws details with the shadow off", () => {
  const { c, calls } = stubContext();
  const seen = [];
  const car = { ...carById("e30"), detail: ctx => seen.push(ctx.shadowBlur) };
  drawCarShape(c, car, { body: "#fff", glow: "#0ff", blur: 26, details: true });
  assert.deepEqual(calls.slice(0, 1), ["beginPath"]);
  assert.ok(calls.includes("fill"));
  assert.equal(c.shadowColor, "#0ff");
  assert.deepEqual(seen, [0]);

  const ghost = stubContext(), none = [];
  drawCarShape(ghost.c, { ...carById("e30"), detail: () => none.push(1) }, { body: "#fff", glow: "#0ff", blur: 10, details: false });
  assert.equal(none.length, 0, "a ghost has no details");
});

test("CAR_SCALE is a positive number", () => {
  assert.ok(Number.isFinite(CAR_SCALE) && CAR_SCALE > 0);
});
