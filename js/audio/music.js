// Background music, synthesized at runtime — no files. A sixteen-bar synthwave
// loop composed per track by compose.js, sequenced on the audio clock: a timer wakes
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

import { on } from "../core/events.js";
import { compose, advance, resume, STEPS_PER_BAR, TOTAL_STEPS, BASS_PUSH } from "./compose.js";

const KEY = "neondrift:music";
// Schedule well ahead: browsers throttle timers in background tabs to once a
// second, and a lookahead longer than that keeps the loop continuous anyway.
// Nothing is lost by it — the mix is gains and a filter, not per-note choices.
const LOOKAHEAD = 1.5, TICK_MS = 250;
// A song exists before the audio does: geometry-loaded fires at boot, long
// before the first tap. Composing needs no AudioContext, so the first song is
// simply waiting when start() runs. If start() somehow beats it, this seed.
const FALLBACK_SEED = "neondrift";

// ---------- the tune ----------
// Composed per track by compose.js from the track's seed (not its geometry
// id: a run's Wide road rebuilds a stage's geometry mid-run and the tune must
// not flip with it). A new song is parked as `pending` and taken by advance()
// on the next bar line, so the beat never stops — the day browser and a run's
// stage changes land as a bar change, not a reload.
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
let cur = { song: null, step: 0 };   // what plays next
let pending = null;

on("geometry-loaded", ({ seed }) => {
  if (!cur.song) { cur = { song: compose(seed), step: 0 }; return; }
  // The track already playing, loaded again (Wide road's rebuild, a restart, a
  // day toggled back within a bar): keep playing, and drop any other pending.
  if (seed === cur.song.seed) { pending = null; return; }
  if (!pending || pending.seed !== seed) pending = compose(seed);
});

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
let timer = null, nextTime = 0;
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

function playStep(song, i, t) {
  const b = song.bars[Math.floor(i / STEPS_PER_BAR)], s = i % STEPS_PER_BAR;
  const STEP = song.step;
  const tones = b.tones;
  const stack = [tones[0], tones[1], tones[2], tones[0] + 12, tones[1] + 12, tones[2] + 12];
  const ts = t + (s % 2 ? song.swing * STEP : 0);   // swing leans the odd sixteenths; the grid stays straight

  // arpeggio: sixteenths (or eighths in a sparse phrase), short and plucky, an octave above the pad
  const fi = b.fig[s % 8];
  if (fi >= 0 && !(b.arpEighths && s % 2)) osc(song.voice.arp, hz(stack[fi] + 12), ts, ts + STEP * 0.9, arpG, 0.06, 0.006, 0.05);

  // bass: style 0 roots on eighths; 1 jumps the octave on the off-beats; 2 the dotted push
  if (b.bass === 2) {
    if (BASS_PUSH.includes(s)) osc("sawtooth", hz(tones[0]), ts, ts + STEP * 1.4, bassG, 0.11, 0.008, 0.06);
  } else if (s % 2 === 0) {
    const up = b.bass === 1 && s % 4 === 2;
    osc("sawtooth", hz(tones[0] + (up ? 12 : 0)), ts, ts + STEP * (up ? 1.2 : 1.7), bassG, up ? 0.08 : 0.11, 0.008, 0.06);
  }

  // pad: one chord per bar, two detuned saws per note, slow in and out
  if (s === 0) {
    const t1 = t + STEP * STEPS_PER_BAR;
    for (const n of tones) {
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, -song.voice.detune);
      osc("sawtooth", hz(n), t, t1 + 0.1, padG, 0.022, 0.35, 0.4, +song.voice.detune);
    }
  }

  // lead: a soft-edged square or triangle, only where the song table says so
  if (b.lead && b.lead[s]) osc(song.voice.lead, hz(b.lead[s]), ts, ts + STEP * 1.8, leadG, 0.03, 0.01, 0.12);

  // drums: four-on-the-floor kick, snare on 2 and 4, hats on every sixteenth or eighth
  if (s % 4 === 0) kick(t);
  if (s === 4 || s === 12) noise(t, 0.14, drumG, 0.14, "bandpass", 1800, 0.8);
  if (b.fill && s >= 12) noise(t, 0.10, drumG, 0.05 + 0.03 * (s - 12), "bandpass", 1800, 0.8);   // rising snare roll
  if (song.drums.hats === "eighths" && s % 2) return;
  const openHat = b.open && s % 4 === 2;
  const hl = song.drums.hatLen;
  noise(ts, (openHat ? 0.12 : s % 4 === 2 ? 0.06 : 0.03) * hl, drumG, openHat ? 0.05 : s % 4 === 2 ? 0.045 : 0.025, "highpass", 7000);
}

// ---------- sequencer ----------

function schedule() {
  const now = ctx.currentTime;
  if (nextTime < now - 0.5) nextTime = now + 0.05;      // fell behind (tab was hidden): skip, don't burst
  while (nextTime < now + LOOKAHEAD) {
    const next = advance(cur, pending);
    if (next.swapped) {
      pending = null;
      filter.Q.setTargetAtTime(next.song.voice.q, nextTime, 0.1);
    }
    playStep(next.song, next.step, nextTime);
    nextTime += next.song.step;
    cur = { song: next.song, step: (next.step + 1) % TOTAL_STEPS };
  }
}

function start() {
  if (timer || !ready) return;
  // A song parked while the music was off is taken now, not at the next bar
  // line — there is no beat to keep. The fallback covers start() before any
  // geometry-loaded.
  cur = resume(cur, pending); pending = null;
  if (!cur.song) cur = { song: compose(FALLBACK_SEED), step: 0 };
  filter.Q.setValueAtTime(cur.song.voice.q, ctx.currentTime);
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

/** For the dev handle: what the mix is doing right now, and which tune. */
export function debug() {
  const s = cur.song;
  const tune = s ? { seed: s.seed, bpm: s.bpm, mode: s.key.mode, mood: s.mood, pending: pending ? pending.seed : null } : {};
  return ready ? { state, enabled, playing: !!timer, filter: filter.frequency.value, bus: bus.gain.value, step: cur.step, ...tune } : { ready: false, ...tune };
}
