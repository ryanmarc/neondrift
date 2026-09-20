// The one AudioContext, its master gain and the hidden-tab suspend. Both the
// sound effects and the music hang off this, so a single tap unlocks everything
// (iOS refuses to start audio outside a real tap handler, and deferring it even
// one frame fails). Effects and music each have their own on/off bus below it.

const MASTER_GAIN = 0.9;

let ctx = null, master = null;
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
    master = ctx.createGain(); master.gain.value = MASTER_GAIN; master.connect(ctx.destination);
    for (const fn of pending) fn(ctx, master);
    pending.length = 0;
    // Created in a background tab (no visibilitychange will have fired): stay
    // silent until the tab is looked at, like the handler below would do.
    if (document.hidden) { ctx.suspend(); return; }
  }
  if (ctx.state === "suspended") ctx.resume();
}

/**
 * Get music going on the title screen. Browsers won't run audio before the
 * user has interacted with the page, so this creates the context now (it may
 * start suspended) and resumes it on the first click, tap or key anywhere.
 * Sites the user has played sound on before are usually allowed to start at
 * once, in which case the listeners are never needed.
 */
export function armAutoplay() {
  unlock();
  if (!ctx || ctx.state === "running") return;
  const kick = () => {
    unlock();
    if (ctx.state === "running") for (const ev of EVENTS) removeEventListener(ev, kick, true);
  };
  const EVENTS = ["pointerdown", "touchend", "keydown", "click"];
  for (const ev of EVENTS) addEventListener(ev, kick, true);
  ctx.addEventListener("statechange", () => {
    if (ctx.state === "running") for (const ev of EVENTS) removeEventListener(ev, kick, true);
  });
}

export function suspend() { if (ctx && ctx.state === "running") ctx.suspend(); }
export function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }

document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend(); else resume();
});
