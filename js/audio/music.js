// Background music, synthesized at runtime — no files. A four-bar synthwave
// loop (A minor: Am F C G) sequenced on the audio clock: a timer wakes every
// 80ms and schedules every note that falls in the next 200ms, which is the
// standard way to keep Web Audio timing tight while the main thread jitters.
// Nodes are created per NOTE (a couple of dozen a second), never per frame.
//
// The loop never stops or restarts; the race only changes the MIX. Three
// states, all reached by gain/filter ramps:
//   menu   – pad and arpeggio only, filter closed, quieter (start screen, countdown)
//   race   – bass and drums in, filter open
//   boost  – filter wide open, arpeggio lifted
//
// Levels here are set by ear against the effects and deliberately under them,
// so the skid and boost cues still read. Final balance wants a phone speaker.

import * as storage from "../core/storage.js";
import { whenReady } from "./context.js";

const KEY = "neondrift:music";
const BPM = 118;
const STEP = 60 / BPM / 4;          // one sixteenth, seconds
const STEPS_PER_BAR = 16;
const BARS = 4;
const LOOKAHEAD = 0.2, TICK_MS = 80;

// ---------- the tune ----------
// MIDI note numbers; 69 = A4 = 440Hz. One chord per bar.
const ARP = [                       // eight-note figures, played twice per bar
  [69, 72, 76, 81, 84, 81, 76, 72], // Am
  [65, 69, 72, 77, 81, 77, 72, 69], // F
  [67, 72, 76, 79, 84, 79, 76, 72], // C
  [67, 71, 74, 79, 83, 79, 74, 71], // G
];
const PAD = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];   // A3 C4 E4 …
const BASS = [57, 53, 60, 55];      // A3 F3 C4 G3 — all above the ~140Hz phone-speaker floor
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// ---------- mix states ----------
const MIX = {
  menu:  { bus: 0.55, filter: 700,  arp: 0.55, pad: 1.0, bass: 0,   drums: 0 },
  race:  { bus: 1.0,  filter: 2600, arp: 1.0,  pad: 0.8, bass: 1.0, drums: 1.0 },
  boost: { bus: 1.0,  filter: 5200, arp: 1.3,  pad: 0.8, bass: 1.0, drums: 1.0 },
};
const BUS_GAIN = 0.35;              // the whole music under the effects (0.42 was too loud, 0.28 too quiet)

let ctx = null;
let bus = null, tone = null, filter = null;               // bus ← filter ← tone layers; drums → bus
let arpG = null, padG = null, bassG = null, drumG = null;
let noiseBuf = null;
let enabled = storage.read(KEY) !== "0";                  // on by default
let state = "menu";
let timer = null, nextTime = 0, step = 0;
let ready = false;

whenReady((c, master) => {
  ctx = c;
  bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
  filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 1.1;
  filter.frequency.value = MIX.menu.filter; filter.connect(bus);
  tone = ctx.createGain(); tone.gain.value = 1; tone.connect(filter);
  arpG = ctx.createGain(); arpG.connect(tone);
  padG = ctx.createGain(); padG.connect(tone);
  bassG = ctx.createGain(); bassG.connect(tone);
  drumG = ctx.createGain(); drumG.connect(bus);

  const len = Math.floor(ctx.sampleRate * 1);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  ready = true;
  applyMix(0);
  if (enabled) start();
});

// ---------- voices ----------

function osc(type, freq, t0, t1, dest, peak, attack, release, detune = 0) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, Math.max(t0 + attack, t1 - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  o.connect(g); g.connect(dest);
  o.start(t0); o.stop(t1 + 0.02);
}

function noise(t0, dur, dest, peak, filterType, freq, q = 1) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0); s.stop(t0 + dur + 0.02);
}

function kick(t0) {
  // Pitch drop kept above the phone-speaker floor: a real sub just distorts there.
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(260, t0);
  o.frequency.exponentialRampToValueAtTime(150, t0 + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
  o.connect(g); g.connect(drumG);
  o.start(t0); o.stop(t0 + 0.3);
  noise(t0, 0.02, drumG, 0.12, "highpass", 2500);        // the click
}

function playStep(i, t) {
  const bar = Math.floor(i / STEPS_PER_BAR) % BARS, s = i % STEPS_PER_BAR;

  // arpeggio: sixteenths, short and plucky
  osc("sawtooth", hz(ARP[bar][s % 8]), t, t + STEP * 0.9, arpG, 0.06, 0.006, 0.05);

  // bass: eighths on the root
  if (s % 2 === 0) osc("sawtooth", hz(BASS[bar]), t, t + STEP * 1.7, bassG, 0.11, 0.008, 0.06);

  // pad: one chord per bar, two detuned saws per note, slow in and out
  if (s === 0) {
    const t1 = t + STEP * STEPS_PER_BAR;
    for (const n of PAD[bar]) {
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, -7);
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, +7);
    }
  }

  // drums: four-on-the-floor kick, snare on 2 and 4, hats on every sixteenth
  if (s % 4 === 0) kick(t);
  if (s === 4 || s === 12) noise(t, 0.14, drumG, 0.14, "bandpass", 1800, 0.8);
  noise(t, s % 4 === 2 ? 0.06 : 0.03, drumG, s % 4 === 2 ? 0.05 : 0.025, "highpass", 7000);
}

// ---------- sequencer ----------

function schedule() {
  const now = ctx.currentTime;
  if (nextTime < now - 0.5) nextTime = now + 0.05;      // fell behind (tab was hidden): skip, don't burst
  while (nextTime < now + LOOKAHEAD) {
    playStep(step, nextTime);
    nextTime += STEP;
    step = (step + 1) % (STEPS_PER_BAR * BARS);
  }
}

function start() {
  if (timer || !ready) return;
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(schedule, TICK_MS);
  applyMix(0.3);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (ready) bus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
}

function applyMix(tau) {
  if (!ready) return;
  const m = MIX[state], t = ctx.currentTime;
  const set = (p, v) => tau > 0 ? p.setTargetAtTime(v, t, tau) : p.setValueAtTime(v, t);
  set(bus.gain, enabled ? BUS_GAIN * m.bus : 0);
  set(filter.frequency, m.filter);
  set(arpG.gain, m.arp); set(padG.gain, m.pad); set(bassG.gain, m.bass); set(drumG.gain, m.drums);
}

// ---------- public API ----------

/** Per-frame: which mix should be playing. Only does work when the state changes. */
export function update(live, boosting) {
  const next = !live ? "menu" : boosting ? "boost" : "race";
  if (next === state) return;
  state = next;
  applyMix(next === "boost" ? 0.12 : 0.35);
}

export function isEnabled() { return enabled; }

/** Flip the music on or off, persist it, and return the new state. */
export function toggle() {
  enabled = !enabled;
  storage.write(KEY, enabled ? "1" : "0");
  if (enabled) start(); else stop();
  return enabled;
}

/** For the dev handle: what the mix is doing right now. */
export function debug() {
  return ready ? { state, enabled, playing: !!timer, filter: filter.frequency.value, bus: bus.gain.value, step } : { ready: false };
}
