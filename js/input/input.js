// The one input: hold a screen half, an arrow key, or a gamepad's stick or
// d-pad to turn that way. Both directions at once cancel out. Announces which
// kind of input the player actually used so the on-screen hint can correct itself.

import { $ } from "../core/dom.js";
import { emit } from "../core/events.js";
import { padState, firstPad } from "./gamepad.js";

let heldLeft = false, heldRight = false;
const pointers = new Map();   // pointerId → -1 (left half) | 1 (right half)

/** -1 = turning left, 1 = turning right, 0 = straight. */
export function steer() {
  const keyed = (heldLeft && heldRight) ? 0 : heldLeft ? -1 : heldRight ? 1 : 0;
  const pad = padSteer();
  if (pad && keyed && pad !== keyed) return 0;   // a key one way and the stick the other cancel, like two keys do
  return keyed || pad;
}

// The Gamepad API has no events for sticks, so it is polled here, at the
// physics rate: getGamepads() is a cheap snapshot and this is the only place
// steering is read. The stick is digital past a deadzone (see gamepad.js).
let lastPad = 0;
function padSteer() {
  const gp = navigator.getGamepads ? firstPad(navigator.getGamepads()) : null;
  if (!gp) return lastPad = 0;
  const x = padState(gp).x;
  if (x && !lastPad) emit("input-mode", "pad");   // once per press, not once per step
  return lastPad = x;
}

function refreshPointers() {
  heldLeft = false; heldRight = false;
  for (const side of pointers.values()) { if (side < 0) heldLeft = true; else heldRight = true; }
}

const stage = $("stage");
stage.addEventListener("pointerdown", e => {
  if (e.target.tagName === "BUTTON") return;
  if (e.target.closest && e.target.closest("#overlay")) return;   // menu/panel taps aren't steering
  pointers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1); refreshPointers();
  // steering by touch OR by clicking the halves both make the on-screen hint correct
  emit("input-mode", "pointer");
}, { passive: true });
const release = e => { pointers.delete(e.pointerId); refreshPointers(); };
stage.addEventListener("pointerup", release, { passive: true });
stage.addEventListener("pointercancel", release, { passive: true });
stage.addEventListener("pointerleave", release, { passive: true });

const isLeft = k => k === "ArrowLeft" || k === "a";
const isRight = k => k === "ArrowRight" || k === "d";
addEventListener("keydown", e => {
  if (isLeft(e.key)) heldLeft = true;
  if (isRight(e.key)) heldRight = true;
  if (isLeft(e.key) || isRight(e.key)) emit("input-mode", "keys");
});
addEventListener("keyup", e => {
  if (isLeft(e.key)) heldLeft = false;
  if (isRight(e.key)) heldRight = false;
});
