// Background music, synthesized at runtime — no files. A sixteen-bar synthwave
// loop in A minor (see SONG below) sequenced on the audio clock: a timer wakes
// every 250ms and schedules every note that falls in the next 1.5s, which is
// the standard way to keep Web Audio timing tight while the main thread jitters.
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
// Schedule well ahead: browsers throttle timers in background tabs to once a
// second, and a lookahead longer than that keeps the loop continuous anyway.
// Nothing is lost by it — the mix is gains and a filter, not per-note choices.
const LOOKAHEAD = 1.5, TICK_MS = 250;

// ---------- the tune ----------
// MIDI note numbers; 69 = A4 = 440Hz. Sixteen bars in four phrases:
//   1  Am F C G   plain
//   2  Am F C G   wider arpeggio, bass jumps the octave, fill into phrase 3
//   3  Dm F Am E  the turn — E major against the minor key gives the tension
//   4  F G Am G   lead melody on top, big fill, then round again
// Bass and pad roots stay above the ~140Hz phone-speaker floor.
const CHORDS = {
  Am: [57, 60, 64], F: [53, 57, 60], C: [60, 64, 67], G: [55, 59, 62],
  Dm: [50, 53, 57], E: [52, 56, 59],
};
// Arpeggio figures index into the chord's six-note stack (triad + triad an
// octave up) and are played twice per bar.
const FIGURES = [
  [0, 1, 2, 3, 4, 3, 2, 1],   // up and down
  [0, 2, 4, 5, 4, 2, 3, 1],   // wider, brighter
  [5, 4, 3, 2, 1, 0, 1, 2],   // falling
];
// Lead melody for phrase 4, one slot per sixteenth (0 = rest).
const LEAD = [
  [76, 0, 0, 0, 79, 0, 0, 0, 81, 0, 0, 0, 79, 0, 76, 0],
  [79, 0, 0, 0, 76, 0, 0, 0, 74, 0, 0, 0, 76, 0, 0, 0],
  [72, 0, 0, 0, 76, 0, 0, 0, 81, 0, 0, 0, 84, 0, 81, 0],
  [79, 0, 0, 0, 76, 0, 74, 0, 72, 0, 0, 0, 0, 0, 0, 0],
];
// One entry per bar: chord, arpeggio figure, bass style (0 roots, 1 octave
// jumps), open hats on the off-beats, snare fill in the last beat, lead line.
const bar = (chord, fig, bass, open, fill, lead) => ({ chord, fig, bass, open, fill, lead });
const SONG = [
  bar("Am", 0, 0, 0, 0, null), bar("F", 0, 0, 0, 0, null), bar("C", 0, 0, 0, 0, null), bar("G", 0, 0, 0, 0, null),
  bar("Am", 1, 1, 1, 0, null), bar("F", 1, 1, 1, 0, null), bar("C", 1, 1, 1, 0, null), bar("G", 1, 1, 1, 1, null),
  bar("Dm", 2, 0, 0, 0, null), bar("F", 2, 0, 0, 0, null), bar("Am", 0, 0, 0, 0, null), bar("E", 2, 0, 0, 1, null),
  bar("F", 1, 1, 1, 0, LEAD[0]), bar("G", 1, 1, 1, 0, LEAD[1]), bar("Am", 1, 1, 1, 0, LEAD[2]), bar("G", 1, 1, 1, 1, LEAD[3]),
];
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const BARS = SONG.length;

// ---------- mix states ----------
const MIX = {
  menu:  { bus: 0.55, filter: 700,  arp: 0.55, pad: 1.0, bass: 0,   drums: 0,   lead: 0.5 },
  race:  { bus: 1.0,  filter: 2600, arp: 1.0,  pad: 0.8, bass: 1.0, drums: 1.0, lead: 1.0 },
  boost: { bus: 1.0,  filter: 5200, arp: 1.3,  pad: 0.8, bass: 1.0, drums: 1.0, lead: 1.2 },
};
const BUS_GAIN = 0.35;              // the whole music under the effects (0.42 was too loud, 0.28 too quiet)

let ctx = null;
let bus = null, tone = null, filter = null;               // bus ← filter ← tone layers; drums → bus
let arpG = null, padG = null, bassG = null, drumG = null, leadG = null;
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
  leadG = ctx.createGain(); leadG.connect(tone);
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
  const b = SONG[Math.floor(i / STEPS_PER_BAR) % BARS], s = i % STEPS_PER_BAR;
  const tones = CHORDS[b.chord];
  const stack = [tones[0], tones[1], tones[2], tones[0] + 12, tones[1] + 12, tones[2] + 12];

  // arpeggio: sixteenths, short and plucky, an octave above the pad
  osc("sawtooth", hz(stack[FIGURES[b.fig][s % 8]] + 12), t, t + STEP * 0.9, arpG, 0.06, 0.006, 0.05);

  // bass: eighths on the root; style 1 jumps the octave on the off-beats
  if (s % 2 === 0) {
    const up = b.bass === 1 && s % 4 === 2;
    osc("sawtooth", hz(tones[0] + (up ? 12 : 0)), t, t + STEP * (up ? 1.2 : 1.7), bassG, up ? 0.08 : 0.11, 0.008, 0.06);
  }

  // pad: one chord per bar, two detuned saws per note, slow in and out
  if (s === 0) {
    const t1 = t + STEP * STEPS_PER_BAR;
    for (const n of tones) {
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, -7);
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, +7);
    }
  }

  // lead: a square with a soft edge, only where the song table says so
  if (b.lead && b.lead[s]) osc("square", hz(b.lead[s]), t, t + STEP * 1.8, leadG, 0.03, 0.01, 0.12);

  // drums: four-on-the-floor kick, snare on 2 and 4, hats on every sixteenth
  if (s % 4 === 0) kick(t);
  if (s === 4 || s === 12) noise(t, 0.14, drumG, 0.14, "bandpass", 1800, 0.8);
  if (b.fill && s >= 12) noise(t, 0.10, drumG, 0.05 + 0.03 * (s - 12), "bandpass", 1800, 0.8);   // rising snare roll
  const openHat = b.open && s % 4 === 2;
  noise(t, openHat ? 0.12 : s % 4 === 2 ? 0.06 : 0.03, drumG, openHat ? 0.05 : s % 4 === 2 ? 0.045 : 0.025, "highpass", 7000);
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
  set(arpG.gain, m.arp); set(padG.gain, m.pad); set(bassG.gain, m.bass); set(drumG.gain, m.drums); set(leadG.gain, m.lead);
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
