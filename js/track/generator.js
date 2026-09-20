// Procedural track generation: a sum of sine harmonics around a circle, resampled
// to an evenly spaced closed centreline, with curvature and tangent/normal per
// sample. Pure: everything comes from the rng that is passed in.

import { TAU, lerp } from "../core/math.js";
import { STEP } from "../config/tuning.js";

/**
 * Build one candidate track from a base radius and a list of harmonics
 * ({k, a, p} = frequency, amplitude, phase).
 * Returns { S, length, minR, flips } where S is the sample array.
 */
export function trackFromAmps(R0, amps) {
  const M = 4000, raw = [];
  for (let i = 0; i < M; i++) {
    const th = i / M * TAU;
    let m = 1;
    for (const h of amps) m += h.a * Math.sin(h.k * th + h.p);
    const r = R0 * m;
    raw.push({ x: Math.cos(th) * r, y: Math.sin(th) * r });
  }
  // arc-length resample to STEP px spacing
  let total = 0; const cum = [0];
  for (let i = 1; i <= M; i++) { const a = raw[i - 1], b = raw[i % M]; total += Math.hypot(b.x - a.x, b.y - a.y); cum.push(total); }
  const count = Math.max(500, Math.round(total / STEP));
  const S = []; let j = 0;
  for (let i = 0; i < count; i++) {
    const d = i / count * total;
    while (j < M - 1 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = (d - cum[j]) / seg;
    const a = raw[j], b = raw[(j + 1) % M];
    S.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  }
  // tangent + normal
  for (let i = 0; i < S.length; i++) {
    const a = S[(i - 1 + S.length) % S.length], b = S[(i + 1) % S.length];
    let tx = b.x - a.x, ty = b.y - a.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    S[i].tx = tx; S[i].ty = ty; S[i].nx = -ty; S[i].ny = tx;
  }
  // curvature: how tight, and how often the turn direction flips
  let minR = 1e9, flips = 0, prev = 0;
  for (let i = 0; i < S.length; i++) {
    const a = S[i], b = S[(i + 1) % S.length];
    let d = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    S[i].curv = d;
    if (Math.abs(d) > 1e-4) minR = Math.min(minR, STEP / Math.abs(d));
    const s = Math.abs(d) > 0.0045 ? Math.sign(d) : 0;
    if (s && prev && s !== prev) flips++;
    if (s) prev = s;
  }
  return { S, length: total, minR, flips };
}

/**
 * Search for a layout that is drivable (min radius > 185px) and interesting
 * (at least 4 direction changes). Falls back to the best rejected candidate.
 */
export function buildTrack(rng) {
  const R0 = 1080 + rng() * 470;
  let fallback = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const pool = [2, 3, 4, 5, 6, 7];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    // always keep a mid harmonic — that's what creates reverse-curvature corners
    const anchor = rng() < 0.5 ? 3 : 4;
    const ks = [anchor, ...pool.filter(k => k !== anchor)].slice(0, 3 + Math.floor(rng() * 3));
    const base = ks.map(k => ({ k, a: (0.6 + rng() * 0.9) / Math.sqrt(k), p: rng() * TAU }));
    const sum = base.reduce((s, h) => s + Math.abs(h.a), 0);
    let scale = 0.46 / sum;
    for (let shrink = 0; shrink < 9; shrink++) {
      // shrink tight high harmonics faster than the broad shape-defining ones
      const amps = base.map(h => ({ k: h.k, a: h.a * scale * Math.pow(scale < 1 ? 0.95 : 1, Math.max(0, h.k - 4) * shrink), p: h.p }));
      const t = trackFromAmps(R0, amps);
      if (t.minR > 185 && t.flips >= 4) return t;
      if (!fallback || (t.flips > fallback.flips && t.minR > 170)) fallback = t;
      scale *= 0.90;
    }
  }
  return fallback;
}
