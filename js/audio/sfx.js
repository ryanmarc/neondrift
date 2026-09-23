// Sound effects, synthesized at runtime with Web Audio — no files. Continuous
// sounds are persistent nodes nudged via setTargetAtTime (never rebuilt per
// frame, which crackles). One-shots are built on demand and self-destruct.
//
// Reacts to game events (boost, chain-break, off-track, countdown, and the
// run's stage-clear / timer-low / run-over) so the physics and race loop never
// import this module for anything but update().

import { clamp } from "../core/math.js";
import { on } from "../core/events.js";
import * as storage from "../core/storage.js";
import { whenReady } from "./context.js";

const MUTE_KEY = "neondrift:mute";

let ctx = null, master = null, noiseBuf = null, noiseSrc = null;
let squealF = null, squealG = null, harmF = null, harmG = null, scrubF = null, scrubG = null;
let offF = null, offG = null, airF = null, airG = null, lfo = null, lfoG = null;
let ready = false;
let muted = storage.read(MUTE_KEY) === "1";

// Build the persistent nodes as soon as the shared context exists. `master`
// here is the effects bus: everything below joins it, and the mute switch is
// its gain, so music is unaffected.
whenReady((c, m) => {
  ctx = c;
  master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(m);

  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;

  // Squeal: a tire doesn't hiss, it rings. Stick-slip in the tread gives a narrow
  // resonant tone, so this is a very high-Q bandpass rather than a broad filter.
  squealF = ctx.createBiquadFilter(); squealF.type = "bandpass";
  squealF.frequency.value = 900; squealF.Q.value = 12;
  squealG = ctx.createGain(); squealG.gain.value = 0;
  noiseSrc.connect(squealF); squealF.connect(squealG); squealG.connect(master);

  // a harmonic above it, so the tone has body instead of sounding like a test tone
  harmF = ctx.createBiquadFilter(); harmF.type = "bandpass";
  harmF.frequency.value = 1850; harmF.Q.value = 7;
  harmG = ctx.createGain(); harmG.gain.value = 0;
  noiseSrc.connect(harmF); harmF.connect(harmG); harmG.connect(master);

  // low scrubbing roar under the squeal — rubber dragging, not ringing
  scrubF = ctx.createBiquadFilter(); scrubF.type = "lowpass"; scrubF.frequency.value = 520;
  scrubG = ctx.createGain(); scrubG.gain.value = 0;
  noiseSrc.connect(scrubF); scrubF.connect(scrubG); scrubG.connect(master);

  // real squeal wavers; a dead-steady pitch is the giveaway that it's synthetic
  lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 6.5;
  lfoG = ctx.createGain(); lfoG.gain.value = 55;
  lfo.connect(lfoG); lfoG.connect(squealF.frequency); lfo.start();

  // boost air: sustained whoosh while the boost is burning
  airF = ctx.createBiquadFilter(); airF.type = "lowpass"; airF.frequency.value = 700;
  airG = ctx.createGain(); airG.gain.value = 0;
  noiseSrc.connect(airF); airF.connect(airG); airG.connect(master);

  // off-track: continuous low rumble for as long as you're past the edge
  offF = ctx.createBiquadFilter(); offF.type = "lowpass"; offF.frequency.value = 380;
  offG = ctx.createGain(); offG.gain.value = 0;
  noiseSrc.connect(offF); offF.connect(offG); offG.connect(master);

  noiseSrc.start();
  ready = true;
});

function tone(freq, dur, vol, type, slideTo, delay) {
  if (!ready) return;
  const t = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator(); o.type = type || "triangle";
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// ---------- one-shots (event driven) ----------

function limit(v) {                             // the moment you cross the edge
  if (!ready) return;
  const t = ctx.currentTime, vol = 0.763 * clamp(v, 0.2, 1);
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + 0.22);
}

function boost() {                              // ignition: soft low shove + bright burst
  if (!ready) return;
  // A pure sine has no harmonics, so none of it lands in the 300-1200Hz band
  // that made the sawtooth version buzz. Felt more than heard.
  // Kept above ~140Hz on purpose: a phone speaker can't move enough air below
  // that, and it distorts trying — which is heard as rasp, not bass.
  tone(280, 0.16, 0.13, "sine", 150);
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  // A swept bandpass reads as air moving past. Static highpassed noise is hiss.
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.3;
  f.frequency.setValueAtTime(2600, t);
  f.frequency.exponentialRampToValueAtTime(700, t + 0.26);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.030, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + 0.28);
}

function count(n) {
  n === 0 ? tone(900, 0.34, 0.046, "triangle") : tone(440, 0.12, 0.083, "triangle");
}

function chainBreak() {                         // combo lost: falling two-tone
  tone(560, 0.13, 0.033, "square", 330);
  tone(300, 0.22, 0.028, "square", 150, 0.11);
}

// ---------- run mode ----------
// Same triangle family as the countdown so they read as the game's own voice;
// levels sit with count() (0.083 at 440Hz) and GO (0.046 at 900Hz), which were
// balanced by A-weighted loudness — a 660Hz triangle at ~0.06 lands between them.

function stageClear() {                         // a stage cleared: rising two-note, GO's register
  tone(660, 0.12, 0.062, "triangle");
  tone(990, 0.30, 0.046, "triangle", 0, 0.11);
}

function timerLow() {                           // clock under TIMER.low: three quick pips, up where alarms live
  // Square, not triangle, so it is not mistaken for a countdown tick; short so
  // it never masks the squeal that is the way out of it.
  for (let i = 0; i < 3; i++) tone(1320, 0.055, 0.026, "square", 0, i * 0.10);
}

function runOver() {                            // the clock hit zero: lower and longer than the chain-break fall
  tone(440, 0.30, 0.036, "square", 220);
  tone(220, 0.55, 0.030, "square", 150, 0.24);
}

on("boost", boost);
on("chain-break", chainBreak);
on("off-track", limit);
on("countdown", count);
on("stage-clear", stageClear);
on("timer-low", timerLow);
on("run-over", runOver);

// ---------- public API ----------

// Context lifecycle (unlock, suspend) lives in context.js; re-exported so call
// sites can keep treating this module as "the sound".
export { unlock, suspend, resume } from "./context.js";

export function isMuted() { return muted; }

/** Flip the effects on or off, persist it, and return the new muted state. */
export function toggleMute() {
  muted = !muted;
  storage.write(MUTE_KEY, muted ? "1" : "0");
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  return muted;
}

/** Per-frame parameter update for the continuous sounds. Pass zeros when not racing. */
export function update(drift, speed, off, boosting) {
  if (!ready) return;
  const t = ctx.currentTime;
  const slide = clamp((drift - 0.12) / 0.75, 0, 1) * clamp(speed / 420, 0, 1);
  squealG.gain.setTargetAtTime(slide * 0.377, t, 0.05);
  harmG.gain.setTargetAtTime(slide * 0.064, t, 0.05);
  scrubG.gain.setTargetAtTime(slide * 0.059, t, 0.05);
  squealF.frequency.setTargetAtTime(780 + drift * 620, t, 0.09);
  harmF.frequency.setTargetAtTime(1650 + drift * 900, t, 0.09);
  offG.gain.setTargetAtTime(off ? clamp(speed / 480, 0, 1) * 0.44 : 0, t, 0.06);
  airG.gain.setTargetAtTime(boosting ? 0.083 : 0, t, 0.09);
  airF.frequency.setTargetAtTime(boosting ? 1400 : 700, t, 0.13);
}
