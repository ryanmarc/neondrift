// The one AudioContext, its master gain, the mute switch and the hidden-tab
// suspend. Both the sound effects and the music hang off this, so a single tap
// unlocks everything (iOS refuses to start audio outside a real tap handler,
// and deferring it even one frame fails).

import * as storage from "../core/storage.js";

const MUTE_KEY = "neondrift:mute";
const MASTER_GAIN = 0.9;

let ctx = null, master = null;
let muted = storage.read(MUTE_KEY) === "1";
const pending = [];   // callbacks waiting for the context to exist

export function getContext() { return ctx; }
export function getMaster() { return master; }

/** Run fn(ctx, master) once the context exists — now if it already does. */
export function whenReady(fn) {
  if (ctx) fn(ctx, master); else pending.push(fn);
}

/** Create the context (first call) and make sure it is running. Call from a tap handler. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER_GAIN; master.connect(ctx.destination);
    for (const fn of pending) fn(ctx, master);
    pending.length = 0;
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function isMuted() { return muted; }

/** Flip mute for everything, persist it, and return the new state. */
export function toggleMute() {
  muted = !muted;
  storage.write(MUTE_KEY, muted ? "1" : "0");
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.05);
  return muted;
}

export function suspend() { if (ctx && ctx.state === "running") ctx.suspend(); }
export function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }

document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend(); else resume();
});
