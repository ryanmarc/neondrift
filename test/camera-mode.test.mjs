import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { camera, nextMode, restoreMode, startAngle } = await import(new URL("render/camera.js", root));

test("the button cycles fixed → chase → cockpit with the flag, fixed ↔ chase without", () => {
  assert.equal(nextMode("fixed", true), "chase");
  assert.equal(nextMode("chase", true), "cockpit");
  assert.equal(nextMode("cockpit", true), "fixed");
  assert.equal(nextMode("fixed", false), "chase");
  assert.equal(nextMode("chase", false), "fixed");
  assert.equal(nextMode("cockpit", false), "fixed");   // a stale cockpit can always get out
});

test("a stored mode restores only when it is still allowed", () => {
  assert.equal(restoreMode("chase", false), "chase");
  assert.equal(restoreMode("cockpit", true), "cockpit");
  assert.equal(restoreMode("cockpit", false), "fixed");  // the flag was dropped
  assert.equal(restoreMode(null, true), "fixed");
  assert.equal(restoreMode("sideways", true), "fixed");
});

test("the camera starts upright in fixed mode, behind the car otherwise", () => {
  const car = { a: 0.7 };
  camera.mode = "fixed";
  assert.equal(startAngle(car), 0);
  camera.mode = "chase";
  assert.equal(startAngle(car), -0.7 - Math.PI / 2);
  camera.mode = "cockpit";
  assert.equal(startAngle(car), -0.7 - Math.PI / 2);
  camera.mode = "fixed";
});
