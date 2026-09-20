// The one input: hold a screen half, or an arrow key, to turn that way.
// Both held at once cancels out. Announces which kind of input the player
// actually used so the on-screen hint can correct itself.

import { $ } from "../core/dom.js";
import { emit } from "../core/events.js";

let heldLeft = false, heldRight = false;
const pointers = new Map();   // pointerId → -1 (left half) | 1 (right half)

/** -1 = turning left, 1 = turning right, 0 = straight. */
export const steer = () => (heldLeft && heldRight) ? 0 : heldLeft ? -1 : heldRight ? 1 : 0;

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
