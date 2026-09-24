import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { padState, risingEdges, firstPad, stepIndex, DEADZONE, BTN } = await import(new URL("input/gamepad.js", root));

// A Gamepad-shaped object: 16 standard-mapping buttons, 4 axes.
function pad({ axes = [0, 0, 0, 0], pressed = [] } = {}) {
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { connected: true, mapping: "standard", axes, buttons };
}

test("stick is digital: inside the deadzone is straight, past it steers", () => {
  assert.equal(padState(pad({ axes: [0.2, 0] })).x, 0);
  assert.equal(padState(pad({ axes: [-0.2, 0] })).x, 0);
  assert.equal(padState(pad({ axes: [-DEADZONE, 0] })).x, -1);
  assert.equal(padState(pad({ axes: [1, 0] })).x, 1);
  assert.equal(padState(pad({ axes: [0, -0.9] })).y, -1);
  assert.equal(padState(pad({ axes: [0, 0.9] })).y, 1);
});

test("d-pad steers too, and both directions at once cancel out", () => {
  assert.equal(padState(pad({ pressed: [BTN.LEFT] })).x, -1);
  assert.equal(padState(pad({ pressed: [BTN.RIGHT] })).x, 1);
  assert.equal(padState(pad({ pressed: [BTN.LEFT, BTN.RIGHT] })).x, 0);
  assert.equal(padState(pad({ axes: [1, 0], pressed: [BTN.LEFT] })).x, 0);   // stick right + d-pad left
  assert.equal(padState(pad({ pressed: [BTN.UP] })).y, -1);
  assert.equal(padState(pad({ pressed: [BTN.DOWN] })).y, 1);
});

test("face buttons and bumpers are read as booleans", () => {
  const s = padState(pad({ pressed: [BTN.A, BTN.RB] }));
  assert.deepEqual([s.a, s.b, s.lb, s.rb], [true, false, false, true]);
});

test("a pad with missing axes or buttons reads as idle", () => {
  const s = padState({ axes: [], buttons: [] });
  assert.deepEqual(s, { x: 0, y: 0, a: false, b: false, lb: false, rb: false });
});

test("rising edges fire once, on the frame a control goes from off to on", () => {
  const idle = padState(pad());
  const held = padState(pad({ axes: [0, 1], pressed: [BTN.A, BTN.LB] }));
  assert.deepEqual(risingEdges(idle, held), { a: true, b: false, lb: true, rb: false, left: false, right: false, up: false, down: true });
  // still held: nothing new
  assert.deepEqual(Object.values(risingEdges(held, held)), Array(8).fill(false));
  // released: nothing either
  assert.deepEqual(Object.values(risingEdges(held, idle)), Array(8).fill(false));
});

test("a nav direction re-fires after passing through centre, and flips count as a new edge", () => {
  const l = padState(pad({ axes: [-1, 0] })), r = padState(pad({ axes: [1, 0] })), c = padState(pad());
  assert.equal(risingEdges(l, r).right, true);
  assert.equal(risingEdges(l, c).right, false);
  assert.equal(risingEdges(c, l).left, true);
});

test("firstPad picks the first connected pad, skipping the nulls getGamepads() leaves", () => {
  const p = pad();
  assert.equal(firstPad([null, p, pad()]), p);
  assert.equal(firstPad([null, null]), null);
  assert.equal(firstPad(undefined), null);
  assert.equal(firstPad([{ ...p, connected: false }]), null);
});

test("stepIndex wraps around the list and is idle on an empty one", () => {
  assert.equal(stepIndex(0, 4, 1), 1);
  assert.equal(stepIndex(3, 4, 1), 0);
  assert.equal(stepIndex(0, 4, -1), 3);
  assert.equal(stepIndex(7, 4, 1), 0);    // stale index past the end resets
  assert.equal(stepIndex(0, 0, 1), 0);
});
