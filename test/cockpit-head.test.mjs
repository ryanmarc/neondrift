import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { COCKPIT, STEP } = await import(new URL("config/tuning.js", root));
const { head, lookAngle, headTarget, carAngle, focalFor, horizonFor, bendLimit, updateHead } =
  await import(new URL("render/head.js", root));

const straight = n => Array.from({ length: n }, (_, i) => ({ x: i * STEP, y: 0, nx: 0, ny: 1, tx: 1, ty: 0 }));
const S = straight(400);
const deg = r => r * 180 / Math.PI;
const ahead = speed => Math.round(Math.max(COCKPIT.lookMin, speed * COCKPIT.lookT) / STEP);

test("the look point is lookT seconds ahead at speed, never nearer than lookMin", () => {
  // from 40px off the line, the angle to the look point says how far along it is
  assert.ok(Math.abs(lookAngle(S, 0, 0, 0, -40) - Math.atan2(40, ahead(0) * STEP)) < 1e-9);
  assert.ok(Math.abs(lookAngle(S, 0, 1000, 0, -40) - Math.atan2(40, ahead(1000) * STEP)) < 1e-9);
});

test("the look point wraps past the end of the lap", () => {
  const short = straight(50);
  const i = (45 + ahead(0)) % 50;
  assert.ok(Math.abs(lookAngle(short, 45, 0, 0, -40) - Math.atan2(40, i * STEP)) < 1e-9);
});

test("the head turns yaw of the way to the look point, capped at lookMax", () => {
  assert.ok(Math.abs(headTarget(0.3, 0.8) - (0.3 + 0.5 * COCKPIT.yaw)) < 1e-12);
  const lim = COCKPIT.lookMax * Math.PI / 180;
  assert.ok(Math.abs(headTarget(0, 3) - lim) < 1e-12);
  assert.ok(Math.abs(headTarget(0, -3) + lim) < 1e-12);
});

test("the car bends toward the view: barely at small angles, never past dMax", () => {
  const dMax = 0.6;
  assert.equal(carAngle(1, 1, dMax), 1);
  assert.ok(Math.abs((1 - carAngle(1, 1 - 0.02, dMax)) - 0.02) < 1e-4);
  let prev = 0;
  for (let off = 0.05; off < 3; off += 0.05) {
    const drawnOff = 1 - carAngle(1, 1 - off, dMax);     // how far the drawn car sits off the view
    assert.ok(drawnOff < dMax && drawnOff > prev);
    prev = drawnOff;
  }
});

test("focal length is measured across the width", () => {
  assert.ok(Math.abs(focalFor(1280, 80) - 640 / Math.tan(40 * Math.PI / 180)) < 1e-9);
});

test("portrait screens get their own horizon", () => {
  assert.equal(horizonFor(1280, 720), 720 * COCKPIT.horizon);
  assert.equal(horizonFor(390, 844), 844 * COCKPIT.horizonPortrait);
});

test("the bend limit is ~34° on a landscape screen and positive on portrait and tiny ones", () => {
  assert.ok(Math.abs(deg(bendLimit(1280, 720, focalFor(1280, 80))) - 33.7) < 0.5);
  for (const [W, H] of [[390, 844], [100, 100], [40, 900]]) {
    const b = bendLimit(W, H, focalFor(W, 80));
    assert.ok(b > 0 && Number.isFinite(b), W + "×" + H);
  }
});

const carOn = (idx, vx) => ({ idx, vx, vy: 0, boosting: false });
const frame = (car, over = {}) => updateHead(car, { samples: S, running: true, rx: car.idx * STEP, ry: 0, ra: 0,
  W: 1280, H: 720, dt: 1 / 60, spanScale: 1, input: 0, ...over });
const target = car => headTarget(0, lookAngle(S, car.idx, Math.hypot(car.vx, car.vy), head.ex, head.ey));

test("the eye sits in the driver's seat", () => {
  frame(carOn(10, 0));
  assert.equal(head.ex, 120);
  assert.equal(head.ey, COCKPIT.seat);   // facing +x, the car's right is +y
});

test("the head snaps to its target while parked or not racing", () => {
  const parked = carOn(10, 0);
  head.h = 1; frame(parked);
  assert.equal(head.h, target(parked));
  const moving = carOn(10, 500);
  head.h = 1; frame(moving, { running: false });
  assert.equal(head.h, target(moving));
});

test("while racing the head follows on a lag and settles on its target", () => {
  const car = carOn(10, 500);
  head.h = 0.5; frame(car);
  assert.ok(head.h < 0.5 && head.h > 0.05);
  for (let i = 0; i < 300; i++) frame(car);
  assert.ok(Math.abs(head.h - target(car)) < 1e-3);
});

test("the field of view eases to fov × spanScale, plus boostFov while boosting", () => {
  const car = carOn(10, 500);
  for (let i = 0; i < 400; i++) frame(car, { spanScale: 0.85 });
  assert.ok(Math.abs(head.fov - COCKPIT.fov * 0.85) < 0.01);
  car.boosting = true;
  for (let i = 0; i < 400; i++) frame(car);
  assert.ok(Math.abs(head.fov - (COCKPIT.fov + COCKPIT.boostFov)) < 0.01);
  assert.ok(Math.abs(head.focal - focalFor(1280, head.fov)) < 1e-9);
});

test("sideways force: one unit at gRef toward the car's right, zero when not racing", () => {
  const car = carOn(10, 500);
  frame(car);
  for (let i = 0; i < 120; i++) { car.vy += COCKPIT.gRef / 60; frame(car); }
  assert.ok(Math.abs(head.g - 1) < 0.05);
  frame(car, { running: false });
  assert.equal(head.g, 0);
});

test("the drawn car follows the bend", () => {
  const car = carOn(10, 500);
  frame(car);
  assert.equal(head.carA, carAngle(head.h, 0, head.dMax));
});

test("a restart (the car parked while the race runs) doesn't roll the cabin", () => {
  const car = carOn(10, 500);
  car.vy = 500;                          // mid-slide, moving sideways
  frame(car);
  car.vx = 0; car.vy = 0;                // placeCar on restart: velocity zeroed, race still running
  frame(car);
  assert.equal(head.g, 0);
});
