// The composer: a seeded sixteen-bar synthwave tune. Pure — no DOM, no
// AudioContext, no module state — so it runs in Node and its constraints are
// checked across hundreds of seeds (test/compose.test.mjs). music.js plays
// whatever this returns and never looks at the seed itself.
//
// The SHAPE is fixed and the CONTENT is drawn. Four four-bar phrases: 1 and 2
// share a "home" progression, 3 is the turn, 4 is a second home that leaves
// the loop pulling back to bar 1. Fills close phrases 2, 3 and 4. A lead sits
// on phrase 4 and sometimes 2. A mood vector is drawn first and every later
// choice is conditioned on it, so a sparse dark track is sparse and dark in
// every part at once rather than a random mixture.
//
// Register: every chord root is voiced into MIDI 50..61 (D3 up), which keeps
// the bass and the pad over the ~140Hz phone-speaker floor the audio work
// depends on. The lead lives two octaves up, 72..86.

import { mulberry32, hashStr } from "../core/random.js";

export const BARS = 16, STEPS_PER_BAR = 16, PHRASE = 4;
export const TOTAL_STEPS = BARS * STEPS_PER_BAR;
export const BPM_MIN = 100, BPM_MAX = 132;
export const ROOT_LO = 50, ROOT_HI = 61;
export const LEAD_LO = 72, LEAD_HI = 86;

// Scales as semitone offsets from the tonic. minorV is aeolian whose V chord
// is major — the E-against-Am tension the original tune used in its turn.
export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian:  [0, 2, 3, 5, 7, 9, 10],
  minorV:  [0, 2, 3, 5, 7, 8, 10],
};

// Progressions in scale degrees (0 = i). "home" phrases sit on the tonic;
// "turn" phrases leave it and land on V. No entry uses ii (diminished).
const DEGREE = { i: 0, III: 2, iv: 3, V: 4, VI: 5, VII: 6 };
const prog = s => s.split(" ").map(d => DEGREE[d]);
export const HOME = ["i VI III VII", "i VII VI VII", "i VI VII i", "i iv VII i", "i III VII iv", "i VI iv VII", "i VII iv VI", "i iv VI VII"].map(prog);
export const TURN = ["iv VI i V", "VI VII i V", "iv VII i V", "iv i VI V", "VI iv i V"].map(prog);

// Arpeggio figures index into the six-note stack (triad plus triad an octave
// up) and repeat twice per bar. -1 is a rest; perturb() plants at most one.
export const FIGURES = {
  upDown:  [0, 1, 2, 3, 4, 3, 2, 1],
  wide:    [0, 2, 4, 5, 4, 2, 3, 1],
  falling: [5, 4, 3, 2, 1, 0, 1, 2],
  rolling: [0, 2, 1, 3, 2, 4, 3, 5],
  pedal:   [0, 3, 0, 4, 0, 5, 0, 4],
  climb:   [0, 1, 3, 4, 5, 4, 2, 1],
};
const FIG_P1 = Object.keys(FIGURES), FIG_P2 = ["wide", "rolling", "climb"], FIG_P3 = ["falling", "pedal"];
// Bass style 2: the dotted push, sixteenth slots per bar.
export const BASS_PUSH = [0, 3, 6, 8, 11, 14];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function weighted(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= Math.max(0, weights[i]); if (r < 0) return items[i]; }
  return items[items.length - 1];
}

/** Semitone offsets from the tonic of the triad on `degree` (0..6) in `mode`. */
export function triad(mode, degree) {
  const scale = MODES[mode];
  const at = k => scale[(degree + k) % 7] + 12 * Math.floor((degree + k) / 7);
  let r = at(0), t = at(2), f = at(4);
  if (mode === "minorV" && degree === 4) t = r + 4;               // the major dominant
  if (mode === "dorian" && degree === 5) { r = 8; t = 12; f = 15; } // dorian's own vi is diminished; borrow aeolian's VI
  return [r, t, f];
}

function drawKey(rng, mood) {
  const w = [0.45, 0.25 + 0.2 * (mood.brightness - 0.5), 0.30 + 0.2 * (mood.dark - 0.5)];
  const mode = weighted(rng, ["aeolian", "dorian", "minorV"], w);
  const tonic = Math.floor(rng() * 12);
  const tonicMidi = ROOT_LO + ((tonic - ROOT_LO) % 12 + 12) % 12;   // the tonic's octave inside the root window
  return { tonic, mode, tonicMidi, scale: MODES[mode] };
}

/** Voice the triad on `degree` with its root in ROOT_LO..ROOT_HI, third and fifth above. */
function voiceChord(key, degree) {
  const [r, t, f] = triad(key.mode, degree);
  let root = key.tonicMidi + r;
  while (root > ROOT_HI) root -= 12;
  return [root, root + (t - r), root + (f - r)];
}

/** One progression per phrase: home, home, turn, a different home that doesn't end on the tonic. */
function drawProgressions(rng) {
  const home1 = pick(rng, HOME);
  const turn = pick(rng, TURN);
  const pool = HOME.filter(p => p !== home1 && p[p.length - 1] !== 0);
  let home2;
  if (pool.length) home2 = pick(rng, pool);
  else { home2 = pick(rng, HOME.filter(p => p !== home1)).slice(); home2[PHRASE - 1] = 6; }
  return [home1, home1, turn, home2];
}

/** A pool figure with (maybe) two slots swapped and (maybe) one slot rested — same contour, different track. */
function perturb(rng, fig, density) {
  const f = fig.slice();
  if (rng() < 0.3 + 0.4 * density) {
    const a = Math.floor(rng() * 8);
    let b = Math.floor(rng() * 7); if (b >= a) b++;
    [f[a], f[b]] = [f[b], f[a]];
  }
  if (rng() < 0.5 * (1 - density)) f[Math.floor(rng() * 8)] = -1;
  return f;
}

/** One figure per phrase: any, a wide one, a falling one, then phrase 2's again. */
function drawFigures(rng, density) {
  const f1 = perturb(rng, FIGURES[pick(rng, FIG_P1)], density);
  const f2 = perturb(rng, FIGURES[pick(rng, FIG_P2)], density);
  const f3 = perturb(rng, FIGURES[pick(rng, FIG_P3)], density);
  return [f1, f2, f3, f2];
}

/** The song for a seed. Same seed, same song, always. */
export function compose(seed) {
  const rng = mulberry32(hashStr(seed));
  const mood = { tempo: rng(), density: rng(), brightness: rng(), dark: rng() };
  mood.leadPhrases = rng() < 0.5 - 0.3 * mood.dark ? [2, 4] : [4];
  const key = drawKey(rng, mood);
  const bpm = Math.round(BPM_MIN + (BPM_MAX - BPM_MIN) * mood.tempo);
  const voice = {
    arp: mood.brightness > 0.55 ? "square" : "sawtooth",
    lead: mood.brightness < 0.4 ? "triangle" : "square",
    detune: 5 + 5 * mood.brightness,
    q: 0.8 + 0.8 * mood.brightness,
  };
  const drums = { hats: mood.density < 0.35 ? "eighths" : "sixteenths", hatLen: 0.8 + 0.4 * mood.brightness };
  const phrases = drawProgressions(rng);
  const figs = drawFigures(rng, mood.density);
  const bassStyle = weighted(rng, [0, 1, 2], [0.25, 0.5, 0.25]);

  const bars = [];
  for (let p = 0; p < BARS / PHRASE; p++) for (let k = 0; k < PHRASE; k++) {
    const degree = phrases[p][k];
    const late = p === 1 || p === 3;                       // phrases 2 and 4 carry the movement
    bars.push({
      degree, tones: voiceChord(key, degree),
      fill: k === PHRASE - 1 && p > 0,
      fig: figs[p],
      arpEighths: mood.density < 0.4 && (p === 0 || p === 2),
      bass: late || (p === 2 && mood.density > 0.65) ? bassStyle : 0,
      open: mood.density > 0.7 && late,
    });
  }

  return {
    seed, bpm, step: 60 / bpm / 4,
    swing: 0.12 * mood.density * mood.brightness,
    mood, key, voice, drums, bars,
  };
}
