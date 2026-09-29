import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { NEAR, makeCam, toCam, project, clipPoly, clipSeg, projectPoly } = await import(new URL("render/project.js", root));

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("camera space: depth runs along the heading, lateral to its right", () => {
  const east = makeCam(0, 0, 0, 20, 500, 400, 300);            // facing +x
  assert.deepEqual(toCam(east, 10, 5, 7), [5, 10, 7]);
  const south = makeCam(0, 0, Math.PI / 2, 20, 500, 400, 300);  // facing +y, down the canvas
  const p = toCam(south, -5, 10, 0);                            // right of south is west (-x)
  assert.ok(close(p[0], 5) && close(p[1], 10));
});

test("straight ahead at eye height lands on the horizon at the screen centre", () => {
  const c = makeCam(0, 0, 0, 20, 500, 400, 300);
  assert.deepEqual(project(c, [0, 100, 20]), [400, 300]);
  assert.deepEqual(project(c, [10, 100, 0]), [450, 400]);     // right of centre, below the horizon
});

test("clipPoly keeps a polygon wholly in front and drops one wholly behind", () => {
  const front = [[-1, 10, 0], [1, 10, 0], [1, 20, 0], [-1, 20, 0]];
  assert.deepEqual(clipPoly(front), front);
  assert.equal(clipPoly([[-1, -10, 0], [1, -10, 0], [1, 1, 0], [-1, 1, 0]]), null);
});

test("clipPoly cuts a straddling polygon on the near plane, interpolating height", () => {
  const out = clipPoly([[-1, -5, 0], [1, -5, 0], [1, 5, 4], [-1, 5, 4]]);
  assert.equal(out.length, 4);
  for (const p of out) assert.ok(p[1] >= NEAR - 1e-9);
  const cut = out.filter(p => close(p[1], NEAR));
  assert.equal(cut.length, 2);
  for (const p of cut) assert.ok(close(p[2], 3.2));   // z 0 at depth -5, 4 at 5 → 3.2 at depth 3
});

test("clipSeg drops, keeps or cuts a segment", () => {
  assert.equal(clipSeg([0, -5, 0], [0, 1, 0]), null);
  const a = [0, 10, 0], b = [0, 20, 0];
  assert.deepEqual(clipSeg(a, b), [a, b]);
  const s = clipSeg([0, -5, 0], [10, 5, 0]);
  assert.ok(close(s[0][1], NEAR) && close(s[0][0], 8));
  assert.deepEqual(s[1], [10, 5, 0]);
});

test("projectPoly is clip then project", () => {
  const c = makeCam(0, 0, 0, 20, 500, 400, 300);
  assert.equal(projectPoly(c, [[0, -9, 0], [1, -9, 0], [1, -8, 0]]), null);
  assert.deepEqual(projectPoly(c, [[0, 100, 20], [10, 100, 0], [0, 100, 0]]), [[400, 300], [450, 400], [400, 400]]);
});
