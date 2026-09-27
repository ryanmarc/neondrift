// Drift layouts: tracks drawn from the vocabulary real drift courses share
// (docs/research/drift-tracks.md). A layout is a list of straights and
// constant-radius arcs. Each family is a recipe for that list, after a real
// course shape. The lap is closed by scaling its same-direction corners to
// 360° and then solving straight lengths and corner angles for the position
// gap. Every candidate is checked against what this car can actually drive
// (no brake, thrust always on), then sampled like the harmonic generator's
// tracks. Pure: everything comes from the rng that is passed in.
//
// Tuning measured with the bootstrap controller, best of the optimiser's
// twelve settings, zero time off-road: a 180° hairpin needs ~400px of radius
// whatever the straight before it; opposite tight corners need ~260px of
// straight between them.

import { TAU } from "../core/math.js";
import { STEP, GUIDE } from "../config/tuning.js";
import { finishSamples, cornerCount, buildTrack } from "./generator.js";

const DEG = Math.PI / 180;

/**
 * Lap length targets in px per family, set so every family laps in about the
 * legacy generator's time (a three-lap race of 45–55s): a family of slow
 * hairpins gets a shorter lap than one of fast sweepers. A layout outside
 * [lo × 0.93, hi × 1.1] is rescaled into it.
 */
export const LAP = {
  entry: [9400, 10800], technical: [9000, 10200], bank: [9400, 10800],
  loop: [8600, 9600], touge: [8000, 8800], flow: [9400, 10600],
};
/**
 * How much more lap each extra (the corner ramp's bumps, esses or lobes)
 * earns, as a fraction; the rest of its road comes out of the main straights.
 * A loop lobe is a reverse hairpin between two corners, so it needs more room.
 */
const GROW = { entry: 0.06, technical: 0.06, bank: 0.06, loop: 0.2, touge: 0.06, flow: 0.06 };
/**
 * A lap must be worth drifting: its corners must turn at least BUSY_TURN +
 * BUSY_PER × (corner target) degrees in total, both ways (a lap must turn 360
 * just to close, so a lap near 360 is a loop of gentle bends), and change
 * direction at least (target / 3) times: a daily (8) needs 680° and three. The corner count alone was met by
 * gentle bends that barely need a slide.
 */
const BUSY_TURN = 360, BUSY_PER = 40;
/** Turns under this many degrees don't count as a direction change. */
const BUSY_MIN_ARC = 30;

/**
 * An upper estimate of cornerCount() from the segments, without sampling: an
 * arc tighter than the guides' corner radius and longer than their minimum
 * is a corner, and same-direction arcs with only a short link between count
 * once. Used to skip sampling candidates that can't beat the best so far.
 */
function cornerEstimate(segs) {
  let n = 0, prevSign = 0, gap = Infinity;
  for (const s of segs) {
    if (!s.R) { gap += s.L; continue; }
    const corner = s.R < GUIDE.minRadius * 1.1 && s.R * Math.abs(s.phi) > GUIDE.minCorner * 0.8;
    if (corner && !(Math.sign(s.phi) === prevSign && gap < 200)) n++;
    if (corner) { prevSign = Math.sign(s.phi); gap = 0; }
  }
  return n;
}

/** Total turn in degrees and direction changes of a closed segment list. */
function busyness(segs) {
  let turn = 0, rev = 0, first = 0, prev = 0;
  for (const s of segs) {
    if (!s.R) continue;
    turn += Math.abs(s.phi) / DEG;
    if (Math.abs(s.phi) / DEG < BUSY_MIN_ARC) continue;
    const sg = Math.sign(s.phi);
    if (!first) first = sg;
    if (prev && sg !== prev) rev++;
    prev = sg;
  }
  if (prev && first && prev !== first) rev++;           // the lap wraps round
  return { turn, rev };
}

/**
 * No lap is longer than this, whatever the family and its extras: a busy
 * daily must still fit a three-lap race well inside the leaderboard's 90s.
 */
const LAP_CAP = 12000;
/** No designed corner is tighter than this; downscaling a lap stops here. */
const R_FLOOR = 195;
/**
 * Two points far apart along the road (arc > LOCAL × distance) must be this
 * far apart: the road's width (264) plus 156px of verge, so two stretches of
 * road never touch or read as one. A hairpin's own two sides are exempt.
 */
const CLEAR = 420, LOCAL = 1.7;
/** Where the start line sits along the longest straight: every race starts on a run-up. */
const START_AT = 0.3;
const TRIES = 800, SHORT_TRIES = 200, CALM_TRIES = 300, EXTRA_MAX = 6;
/**
 * The daily's corner target, when no shape asks for one: about what a late
 * gauntlet stage has (the ramp tops out at 9). Eight, not nine, because entry
 * adds corners three at a time and nine would push it to eleven and a lap
 * too long for a three-lap race under the leaderboard's 90s ceiling.
 */
export const DAILY_CORNERS = 8;
/** Largest end gap the shear may absorb, as a fraction of the lap. */
const SHEAR_MAX = 0.04;

// ---------- segments ----------
// Straight { L }, arc { R, phi } (phi signed: + turns left). `loop` marks a
// same-direction corner that carries the lap's net turning; `adj` marks a
// straight the closure may lengthen or shorten, within [min, max].

const straight = (L, adj = false) => ({ L, adj });
const arc = (dir, R, deg, loop = false) => ({ R, phi: dir * deg * DEG, loop });
const segLen = s => (s.R ? s.R * Math.abs(s.phi) : s.L);

/** Start poses of every segment plus the end pose, from (0,0) heading 0. */
function poses(segs) {
  let x = 0, y = 0, h = 0;
  const out = [];
  for (const s of segs) {
    out.push({ x, y, h });
    if (s.R) {
      const k = s.phi / segLen(s);
      x += (Math.sin(h + s.phi) - Math.sin(h)) / k;
      y -= (Math.cos(h + s.phi) - Math.cos(h)) / k;
      h += s.phi;
    } else {
      x += Math.cos(h) * s.L; y += Math.sin(h) * s.L;
    }
  }
  out.push({ x, y, h });
  return out;
}

/**
 * The tightest centreline radius a corner of `phi` radians can have and still
 * be driven. The car has no brake and thrust is always on, so its tightest
 * sustainable line is about LINE_R; the widest line through a corner
 * (outside, apex, outside) has radius R − W + 2W / (1 − cos(φ/2)) for a
 * usable half-width W. A hairpin gains almost nothing from the road's width,
 * a 90° corner gains a lot. Measured on stadium tracks: a 180° hairpin needs
 * ~400px whatever the straight before it, which this gives.
 */
const LINE_R = 560, LINE_W = 100;
export const drivableR = phi => Math.max(R_FLOOR, LINE_R + LINE_W - 2 * LINE_W / (1 - Math.cos(Math.min(Math.PI, Math.abs(phi)) / 2)));

/** The widest turn (radians) a corner of radius R can be driven through: drivableR inverted. */
const drivablePhi = R => (R >= LINE_R ? Math.PI * 2 : 2 * Math.acos(Math.max(-1, 1 - 2 * LINE_W / (LINE_R + LINE_W - R))));

/** Same-direction corners closer than this are one corner to the car: it can't straighten between them. */
const MERGE = 250;
/**
 * Opposite corners need this much straight between them when either is
 * tighter than SWITCH_R: traction takes chargeDown + slipLagOut to come back
 * after a slide, and without it the car carries the first slide off the road.
 */
const SWITCH = 260, SWITCH_R = 450;

/**
 * True when every corner can be driven. Same-direction arcs joined by a link
 * shorter than MERGE count as one corner: their turn adds up and the
 * tightest of them sets the radius.
 */
function drivable(segs, why = () => {}) {
  const n = segs.length;
  for (let i = 0; i < n; i++) {
    const a = segs[i];
    if (!a.R) continue;
    let phi = a.phi, R = a.R;
    for (let k = 1; k < n; k++) {
      const s = segs[(i + k) % n];
      if (s.R) { if (Math.sign(s.phi) !== Math.sign(a.phi)) break; phi += s.phi; R = Math.min(R, s.R); }
      else if (s.L >= MERGE) break;
    }
    if (R < drivableR(phi)) { why("drivable:radius@" + i); return false; }
    // a switchback: the next corner turns the other way; the car needs room to regain grip first
    let gap = 0, k = 1, b = null;
    for (; k < n; k++) { const s = segs[(i + k) % n]; if (s.R) { b = s; break; } gap += s.L; }
    if (b && Math.sign(b.phi) !== Math.sign(a.phi) && Math.min(a.R, b.R) < SWITCH_R && gap < SWITCH) { why("drivable:switch@" + i); return false; }
  }
  return true;
}

/** Most a corner may turn after scaling: a tight one past ~185° would fold onto itself. */
const maxTurn = R => (R >= 400 ? 215 : 185);

/** Scale the loop corners so the lap turns exactly ±360°. False if that bends one out of shape. */
function closeTurning(segs, dir) {
  let net = 0, loop = 0;
  for (const s of segs) if (s.R) { if (s.loop) loop += s.phi; else net += s.phi; }
  const k = (dir * TAU - net) / loop;
  if (!(k > 0.5 && k < 2)) return false;
  for (const s of segs) if (s.R && s.loop) {
    s.phi *= k;
    const deg = Math.abs(s.phi) / DEG;
    if (deg > maxTurn(s.R) || deg < 12 || Math.abs(s.phi) > drivablePhi(s.R)) return false;
  }
  return true;
}

/**
 * Stretch the straights so the lap comes out near `target`: the main
 * (adjustable) ones by a factor f, the short links between corners by only
 * √f. Corners keep their designed radius, so a short recipe gets a longer
 * run-up and slightly longer links, not gentler or scattered hairpins.
 */
function fitLength(segs, target) {
  let arcs = 0, main = 0, links = 0;
  for (const s of segs) if (s.R) arcs += segLen(s); else if (s.adj) main += s.L; else links += s.L;
  // solve main·f + links·√f = target − arcs for √f (a quadratic in √f)
  const need = target - arcs;
  const r = need > 0 ? (-links + Math.sqrt(links * links + 4 * main * need)) / (2 * main) : 0.8;
  const f = Math.max(0.6, r * r);
  for (const s of segs) if (!s.R) s.L *= s.adj ? f : Math.sqrt(f);
}

/**
 * Close the lap: its end must meet its start in position and in heading.
 * The levers are every straight's length and every loop corner's angle. Each
 * Gauss–Newton step takes the change with the smallest *relative* size
 * (weights L² and φ²), so long straights and big corners absorb most of it
 * and links and hairpins barely move. A lever that hits its bounds is fixed
 * there and the rest re-solve. Returns what is left of the position gap for
 * the shear, or null if the heading could not be held at ±360°.
 */
function closeLap(segs, dir, why = () => {}) {
  const free = [];
  for (const s of segs) {
    if (s.R) {
      if (!s.loop) continue;
      const a = Math.abs(s.phi);
      const hi = Math.min(maxTurn(s.R) * DEG, a * 1.35, drivablePhi(s.R));
      if (hi < a) { why("lever"); return null; }    // already past what its radius can drive
      free.push({ s, arc: true, lo: Math.max(12 * DEG, a * 0.65), hi, w: a * a });
    } else {
      const lo = s.adj ? Math.max(250, s.L * 0.45) : Math.max(s.L * 0.8, Math.min(s.L, SWITCH));   // links keep their spacing: transitions need it
      const hi = s.adj ? Math.max(2600, s.L * 1.6) : s.L * 2;
      free.push({ s, arc: false, lo, hi, w: s.L * s.L });
    }
  }
  const endOf = () => { const P = poses(segs); return P[P.length - 1]; };
  const get = f => (f.arc ? Math.abs(f.s.phi) : f.s.L);
  const set = (f, v) => { if (f.arc) f.s.phi = Math.sign(f.s.phi) * v; else f.s.L = v; };
  let end = endOf();
  for (let iter = 0; iter < 12 && free.length >= 3; iter++) {
    const r = [end.x, end.y, end.h - dir * TAU];
    if (Math.hypot(r[0], r[1]) < 0.5 && Math.abs(r[2]) < 1e-7) break;
    // Jacobian columns: d(end x, end y, end heading) per unit change of each lever
    const P = poses(segs), idx = new Map(segs.map((s, i) => [s, i]));
    const cols = free.map(f => {
      if (!f.arc) { const h = P[idx.get(f.s)].h; return [Math.cos(h), Math.sin(h), 0]; }
      const v = get(f), eps = 1e-5;
      set(f, v + eps); const e2 = endOf(); set(f, v);
      return [(e2.x - end.x) / eps, (e2.y - end.y) / eps, (e2.h - end.h) / eps];
    });
    // M = J W Jᵀ (3×3), λ = M⁻¹(−r), Δ = W Jᵀ λ
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    free.forEach((f, k) => { const c = cols[k]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += f.w * c[i] * c[j]; });
    const lam = solve3(M, [-r[0], -r[1], -r[2]]);
    if (!lam) break;
    let clamped = false;
    for (let k = free.length - 1; k >= 0; k--) {
      const f = free[k], c = cols[k];
      const want = get(f) + f.w * (c[0] * lam[0] + c[1] * lam[1] + c[2] * lam[2]);
      const v = Math.min(f.hi, Math.max(f.lo, want));
      set(f, v);
      if (v !== want) { free.splice(k, 1); clamped = true; }
    }
    end = endOf();
    if (!clamped && Math.hypot(end.x, end.y) < 0.5 && Math.abs(end.h - dir * TAU) < 1e-7) break;
  }
  if (Math.abs(end.h - dir * TAU) > 1e-6) { why(free.length < 3 ? "levers-clamped" : "no-converge"); return null; }
  return { x: end.x, y: end.y };
}

/** Solve a 3×3 linear system by Cramer's rule; null if singular. */
function solve3(M, b) {
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (!Number.isFinite(D) || Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map(c => det(M.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)))) / D);
}

/**
 * Sample a segment list at STEP spacing from `start` px along it, rotated by
 * `rot`. A leftover end gap is sheared out along the lap (each point moves by
 * gap × its fraction of the lap): straights stay straight and corners change
 * by the gap's share of the lap, which the caller keeps small. The sheared
 * curve is resampled by arc length, so the spacing is exact either way.
 */
function sample(segs, start, rot, gap) {
  const P = poses(segs), lens = segs.map(segLen);
  const total = lens.reduce((a, b) => a + b, 0);
  const M = Math.ceil(total / 6);
  const c = Math.cos(rot), sn = Math.sin(rot);
  const raw = [];
  let k = 0, acc = 0;
  for (let i = 0; i < M; i++) {
    const d = i / M * total;
    while (k < segs.length - 1 && acc + lens[k] <= d) { acc += lens[k]; k++; }
    const s = segs[k], p = P[k], t = d - acc;
    let x, y;
    if (s.R) {
      const kap = s.phi / lens[k];
      x = p.x + (Math.sin(p.h + kap * t) - Math.sin(p.h)) / kap;
      y = p.y - (Math.cos(p.h + kap * t) - Math.cos(p.h)) / kap;
    } else {
      x = p.x + Math.cos(p.h) * t; y = p.y + Math.sin(p.h) * t;
    }
    x -= gap.x * d / total; y -= gap.y * d / total;
    raw.push({ x: x * c - y * sn, y: x * sn + y * c });
  }
  // arc-length resample, starting `start` px along the (unsheared) lap
  const cum = [0];
  for (let i = 1; i <= M; i++) { const a = raw[i - 1], b = raw[i % M]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const len = cum[M], s0 = start / total * len;
  const count = Math.max(500, Math.round(len / STEP));
  const S = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const d = (s0 + i / count * len) % len;
    if (d < cum[j]) j = 0;
    while (j < M - 1 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = (d - cum[j]) / seg;
    const a = raw[j], b = raw[(j + 1) % M];
    S.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return finishSamples(S, len);
}

/**
 * True when no two stretches of road come close: any pair of samples that is
 * far apart along the road relative to its straight-line distance must be at
 * least CLEAR apart. A single corner's own two sides are exempt (arc ≤ LOCAL ×
 * chord up to about 185° of turn).
 */
export function clear(S, spacing = STEP, clearance = CLEAR, every = 2) {
  const N = S.length;
  for (let i = 0; i < N; i += every) for (let j = i + every; j < N; j += every) {
    const dx = S[i].x - S[j].x, dy = S[i].y - S[j].y, d2 = dx * dx + dy * dy;
    if (d2 >= clearance * clearance) continue;
    const arcLen = Math.min(j - i, N - (j - i)) * spacing;
    if (arcLen > LOCAL * Math.sqrt(d2)) return false;
  }
  return true;
}

/**
 * Points every `step` px along a segment list (no shear, no rotation): a
 * cheap outline for rejecting a layout before the full sample.
 */
function outline(segs, step) {
  const P = poses(segs), out = [];
  segs.forEach((s, k) => {
    const len = segLen(s), p = P[k], n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n * len;
      if (s.R) {
        const kap = s.phi / len;
        out.push({ x: p.x + (Math.sin(p.h + kap * t) - Math.sin(p.h)) / kap, y: p.y - (Math.cos(p.h + kap * t) - Math.cos(p.h)) / kap });
      } else out.push({ x: p.x + Math.cos(p.h) * t, y: p.y + Math.sin(p.h) * t });
    }
  });
  return out;
}

// ---------- recipes ----------
// Each takes (u, d, x): u(a, b) draws uniformly, d is the lap direction (+1,
// clockwise on screen; the recipes are written for either),
// x is how many extra bumps to add (the run's corner ramp).

/** Alternating corners starting in direction `d`: esses, a power alley, a switchback run. */
function esses(u, d, n, R0 = 330, R1 = 420) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(arc(i % 2 ? -d : d, u(R0, R1), u(50, 85)), straight(u(280, 380)));
  }
  return out;
}

/**
 * `n` extra switchbacks for the run's corner ramp. Each is a symmetric bump:
 * out by a, back across by 2a, out by a, on one radius and one link length,
 * so it leaves the road on the line and heading it found it. The lap's
 * closure only sees a shorter straight. Three corners each, a chicane on a
 * straight, and every transition keeps the switchback room.
 */
function bumps(u, d, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = u(40, 62), R = u(360, 420), L = u(280, 360);
    out.push(arc(-d, R, a), straight(L), arc(d, R, 2 * a), straight(L), arc(-d, R, a), straight(u(300, 500), true));
  }
  return out;
}

/**
 * A run of `n` (odd) alternating corners, first one turning `s`, built
 * mirror-symmetric (radii, turns and links read the same from either end)
 * with the middle corner's turn solved so the run's turns cancel. A mirror-
 * symmetric curvature profile that nets no turn leaves the road on the line
 * and heading it found it, so the lap's closure only sees a shorter straight.
 * Technical's extra corners: more esses, not a generic chicane.
 */
function symEsses(u, s, n) {
  const k = (n - 1) / 2;
  for (let tries = 0; tries < 50; tries++) {
    const a = [], R = [], L = [];
    for (let i = 0; i < k; i++) { a.push(u(40, 85)); R.push(u(360, 420)); L.push(u(290, 380)); }
    const sign = i => (i % 2 ? -s : s);
    let net = 0;
    for (let i = 0; i < k; i++) net += 2 * sign(i) * a[i];
    const c = -net / sign(k), Rc = u(360, 420);
    if (c < 30 || c > 125) continue;
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = i < k ? i : n - 1 - i;              // mirrored index
      out.push(i === k ? arc(sign(i), Rc, c) : arc(sign(i), R[m], a[m]));
      if (i < n - 1) out.push(straight(L[i < k ? i : n - 2 - i]));
    }
    return out;
  }
  return [arc(s, 380, 45), straight(320), arc(-s, 380, 90), straight(320), arc(s, 380, 45)];   // the plain bump
}

/**
 * `n` more reverse hairpins for loop's technical middle. Each is built like
 * the chicane bump, mirror-symmetric: a corner with the lap by a, a reverse
 * hairpin by 2a, a corner with the lap by a, on matching radii and links. It
 * leaves the road on the line and heading it found it, so the lap's closure
 * never sees it; a Z-shaped lobe jogged the road sideways and rarely closed.
 */
function lobes(u, d, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = u(62, 72), Ro = u(360, 400), L = u(280, 320);
    out.push(
      straight(u(280, 340)),
      arc(d, Ro, a), straight(L),
      arc(-d, u(420, 460), 2 * a), straight(L),
      arc(d, Ro, a),
    );
  }
  return out;
}

// ---------- recipe grammar ----------
// A family is a grammar, not a fixed sequence: its signature elements are
// always there, and how many other elements it has, which ones, in what
// order, and how the lap's turn is shared between them are all drawn. That
// is what makes two tracks of one family different shapes, not one shape
// rotated. The closure then scales the corners with the lap to 360°.

/** A whole number in [a, b], drawn with u. */
const int = (u, a, b) => Math.min(b, a + Math.floor(u(0, b - a + 1)));
/** One of the items, drawn with u. */
const pick = (u, items) => items[int(u, 0, items.length - 1)];
/** The items in a drawn order. */
function shuffled(u, items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = int(u, 0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** A link between corners: room for a switchback either way. */
const link = u => straight(u(280, 420));
/** A corner with the lap, somewhere between a fast bend and a near-hairpin. */
const lapCorner = (u, d) => arc(d, u(360, 500), u(45, 130), true);

export const RECIPES = {
  // Autopolis / Meihan. Signature: a very long run-up into one huge committed
  // sweeper, and a switchback into a hairpin. Drawn: what else the lap has
  // (S-bends, corners, double apexes, fast kinks), in what order, and how
  // long the way home is. Extra corners are more of those.
  entry: (u, d, x) => {
    const signature = [link(u), arc(-d, u(340, 420), u(60, 95)), link(u), arc(d, u(420, 480), u(130, 170), true)];
    const pool = [
      () => [link(u), arc(-d, u(380, 440), u(60, 100)), link(u), lapCorner(u, d)],   // an S: a turn-back
      () => [link(u), arc(-d, u(380, 440), u(60, 100)), link(u), lapCorner(u, d)],   // (twice as likely)
      () => [link(u), lapCorner(u, d)],
      () => [link(u), arc(d, u(380, 480), u(50, 90), true), straight(u(280, 360)), arc(d, u(380, 480), u(50, 90), true)],
      () => [straight(u(400, 700), true), arc(d, u(800, 1300), u(20, 45), true)],
    ];
    // extra corners (the ramp) are more of entry's own elements, one or two corners each
    const extras = Array.from({ length: int(u, 1, 2) + x }, () => pick(u, pool)());
    const middle = shuffled(u, [signature, ...extras]).flat();
    return [
      straight(u(1500, 2200), true),
      arc(d, u(420, 540), u(120, 190), true),
      ...middle,
      straight(u(500, 1000), true),
      ...(u(0, 1) < 0.5 ? [lapCorner(u, d)] : [lapCorner(u, d), straight(u(300, 700), true), lapCorner(u, d)]),
      straight(u(300, 600), true),
    ];
  },
  // Tsukuba. Signature: feints on a straight, a committed T1, a run of esses,
  // a hairpin. Drawn: two or three feints, whether the esses come before the
  // hairpin, after it or both sides, an extra corner, and the way home.
  technical: (u, d, x) => {
    const fR = u(650, 900), nf = int(u, 2, 3);
    const feints = [];
    for (let i = 0; i < nf; i++) { if (i) feints.push(straight(u(90, 160))); feints.push(arc(i % 2 ? -d : d, fR, i % 2 ? u(30, 45) : u(15, 28))); }
    const hairpin = [arc(d, u(420, 480), u(135, 175), true)];
    const gap = () => straight(u(340, 460));
    // esses then the hairpin, the hairpin then esses, or esses either side of it
    const middle = pick(u, [
      () => [...symEsses(u, -d, 3 + 2 * x), gap(), ...hairpin],
      () => [...hairpin, gap(), ...symEsses(u, -d, 3 + 2 * x)],
      () => [...symEsses(u, -d, 3), gap(), ...hairpin, gap(), ...symEsses(u, -d, 1 + 2 * x)],
    ])();
    // the way home: one corner, two, or two around a switchback
    const home = pick(u, [
      () => [lapCorner(u, d)],
      () => [lapCorner(u, d), straight(u(300, 600), true), lapCorner(u, d)],
      () => [lapCorner(u, d), link(u), arc(-d, u(360, 440), u(40, 80)), link(u), lapCorner(u, d)],
    ])();
    return [
      straight(u(600, 1000), true),
      ...feints,
      straight(u(250, 450), true),
      arc(d, u(390, 460), u(70, 115), true),       // T1: fast in off the feints, so the flick needs room
      straight(u(340, 460)),
      ...middle,
      ...(u(0, 1) < 0.5 ? [straight(u(300, 600), true), lapCorner(u, d)] : []),
      straight(u(600, 1100), true),
      ...home,
      straight(u(300, 600), true),
    ];
  },
  // Irwindale / Evergreen / Orlando. Signature: banked ends ridden flat out,
  // a switchback power alley. Drawn: an oval, a D (one tight end), a
  // tri-oval or a square oval; each end one big sweeper or two ~90s around a
  // chute; which straight
  // has the power alley, and a kink on another.
  bank: (u, d, x) => {
    const ends = pick(u, [2, 2, 3, 4]);          // an oval, a tri-oval, a square oval
    const share = ends === 2 && u(0, 1) < 0.4 ? [1.25, 0.75] : Array(ends).fill(1);   // a D: one end tighter
    // what each straight carries: one power alley somewhere, a drawn extra or
    // not, and one more per extra corner the ramp asks for, spread around
    // Half the time everything goes on one straight (one busy infield side,
    // one fast plain side, like Irwindale), half the time it spreads round.
    const feats = Array.from({ length: ends }, () => []);
    const home = int(u, 0, ends - 1), oneSide = u(0, 1) < 0.5;
    feats[home].push("alley");
    for (let k = int(u, 0, 1) + x; k > 0; k--) feats[oneSide ? home : int(u, 0, ends - 1)].push(pick(u, ["alley", "kink", "bump"]));
    const feature = f => f === "alley" ? [...symEsses(u, -d, 3), straight(u(300, 500), true)]
      : f === "kink" ? [arc(d, u(900, 1400), u(15, 30), true), straight(u(400, 700), true)]
      : bumps(u, d, 1);
    const out = [];
    for (let e = 0; e < ends; e++) {
      out.push(straight(e === 0 ? u(1000, 1500) : u(500, 1100), true));
      for (const f of shuffled(u, feats[e])) out.push(...feature(f));
      const turn = 360 / ends * share[e] * u(0.9, 1.1), R = u(440, 560);
      if (turn > 150 && u(0, 1) < 0.5) out.push(arc(d, R, turn / 2, true), straight(u(200, 450), true), arc(d, R, turn / 2, true));
      else out.push(arc(d, R, turn, true));
    }
    return out;
  },
  // Greinbach. Signature: a big sweeper and a slow technical middle with a
  // reverse hairpin. Drawn: whether the sweeper comes before or after the
  // middle, the middle's corners, and the way home (a fast chicane, or an S
  // into a corner or a kink). Extra corners are more reverse hairpins
  // (symmetric lobes), which take the way home's road and some of the
  // sweeper's.
  loop: (u, d, x) => {
    const cR = u(460, 560);
    const sweeper = [arc(d, u(460, 540), x ? u(100, 140) : u(130, 195), true)];
    const middle = [
      arc(d, u(360, 420), u(70, 100), true), link(u),
      arc(-d, u(420, 480), u(140, 165)), link(u),
      arc(d, u(380, 460), u(80, 130), true),
      ...lobes(u, d, x),
    ];
    // the way home always turns back once: a fast chicane, or an S before a
    // corner or a kink (unless extra lobes took its road)
    const home = x ? [] : pick(u, [
      () => [arc(-d, cR, u(35, 55)), straight(u(40, 100)), arc(d, cR, u(35, 55)), straight(u(280, 380))],
      () => [arc(-d, u(380, 460), u(45, 80)), link(u), lapCorner(u, d), straight(u(300, 500), true)],
      () => [arc(-d, u(380, 460), u(45, 80)), link(u), arc(d, u(900, 1300), u(30, 60), true), straight(u(300, 500), true)],
    ])();
    const body = u(0, 1) < 0.6
      ? [...sweeper, straight(u(270, 400)), ...middle, straight(u(300, 600), true)]
      : [...middle, straight(u(300, 600), true), ...sweeper, straight(u(300, 600), true)];
    return [
      straight(x ? u(800, 1200) : u(1000, 1500), true),
      ...body,
      ...home,
      straight(u(200, 400), true),
      arc(d, u(360, 500), u(80, 140), true),
    ];
  },
  // Irohazaka / Haruna. Signature: a stack of alternating hairpins climbing
  // away from a long straight. Drawn: the approach (a fast kink or a corner,
  // at any angle), the stack's turns and spacing, and the way home (one
  // corner, two, or a corner and a switchback).
  touge: (u, d, x) => {
    const out = [
      straight(u(1200, 1900), true),
      u(0, 1) < 0.5 ? arc(d, u(900, 1400), u(20, 90), true) : arc(d, u(440, 520), u(30, 90), true),
      straight(u(350, 700), true),
    ];
    // the stack: three hairpins, their turn and spacing drawn, one gap sometimes long
    const n = 3, turn = u(100, 145), longGap = int(u, -1, n - 2);
    for (let i = 0; i < n; i++) {
      out.push(arc(i % 2 ? -d : d, u(420, 480), turn * u(0.9, 1.1), !(i % 2)));
      if (i < n - 1) out.push(straight(i === longGap ? u(500, 800) : u(300, 480)));
    }
    out.push(straight(u(350, 650), true));
    // the way home: one corner, two, or a corner and a switchback
    const home = pick(u, [
      () => [lapCorner(u, d), straight(u(500, 1000), true)],
      () => [arc(d, u(320, 450), u(40, 70), true), straight(u(600, 1000), true)],
      () => [lapCorner(u, d), straight(u(400, 700), true), lapCorner(u, d), straight(u(400, 800), true)],
      () => [lapCorner(u, d), link(u), arc(-d, u(360, 440), u(40, 80)), link(u), straight(u(300, 700), true)],
    ]);
    out.push(...home(), ...bumps(u, d, x), lapCorner(u, d), straight(u(200, 400), true));
    return out;
  },
  // Rudskogen / Mondello. Signature: many medium corners and real turn-backs:
  // two or three corners against the lap, each an S between corners with it.
  // Drawn: how many corners, where the turn-backs fall, how sharp each is,
  // and where the one or two long straights go.
  flow: (u, d, x) => {
    const n = int(u, 5, 7) + 2 * x;
    // turn-backs: not first or last, never two in a row, so each is an S
    const slots = shuffled(u, Array.from({ length: n - 2 }, (_, i) => i + 1));
    const against = new Set(), want = int(u, 2, Math.min(3, Math.floor((n - 1) / 2)));
    for (const i of slots) if (against.size < want && !against.has(i - 1) && !against.has(i + 1)) against.add(i);
    const long = new Set(shuffled(u, Array.from({ length: n }, (_, i) => i).filter(i => !against.has(i) && !against.has(i + 1))).slice(0, int(u, 1, 2)));
    const out = [straight(u(700, 1200), true)];
    for (let i = 0; i < n; i++) {
      out.push(against.has(i) ? arc(-d, u(340, 420), u(60, 110)) : arc(d, u(380, 500), u(60, 150), true));
      const intoS = against.has(i) || against.has(i + 1);
      out.push(intoS ? straight(u(280, 380)) : long.has(i) ? straight(u(500, 1000), true) : straight(u(260, 420), u(0, 1) < 0.3));
    }
    return out;
  },
};

/**
 * Build a drift layout of `family` from the rng. `shape` is the run's target
 * ({ minR, corners, lapScale }); the daily passes nothing and asks for
 * DAILY_CORNERS. The corner floor is best-effort: a family that can't carry that
 * many returns its most-cornered drivable layout, and one that can't reach
 * the busyness bar returns its busiest. Always returns a track: if no
 * candidate is drivable at all, the legacy generator runs on the same rng.
 * `stats`, if given, counts why candidates were rejected (for tuning).
 * @returns { S, length, minR, flips, family } — family is null on the fallback
 */
export function buildDriftTrack(rng, family, shape = {}, stats = null) {
  const why = r => { if (stats) stats[r] = (stats[r] || 0) + 1; };
  const minR = shape.minR ?? 185, want = shape.corners || DAILY_CORNERS, lapScale = shape.lapScale ?? 1;
  const recipe = RECIPES[family];
  const u = (a, b) => a + rng() * (b - a);
  let extra = 0, short = null, calm = null;
  // A run's Wide road (lapScale) rebuilds the accepted layout larger, after
  // the search, as the harmonic generator does: searching at the larger size
  // would accept a different layout, not the same one made wider.
  const finish = f => {
    if (lapScale === 1) return { ...f.t, family };
    for (const s of f.segs) { if (s.R) s.R *= lapScale; else s.L *= lapScale; }
    return { ...sample(f.segs, f.at * lapScale, f.rot, { x: f.shear.x * lapScale, y: f.shear.y * lapScale }), family };
  };
  for (let attempt = 0; attempt < TRIES; attempt++) {
    // A family that already has a good layout short of the corner floor (or
    // the busyness bar) has probably met its limit: stop looking, so a build
    // stays a few ms (the leaderboard worker builds tracks too).
    if (short && attempt >= SHORT_TRIES) break;
    if (calm && attempt >= CALM_TRIES) break;
    // Every lap runs clockwise on screen, like the harmonic generator's: with
    // canvas y pointing down, a lap whose heading turns +360° is clockwise.
    const d = 1;
    const rot = rng() * TAU;
    const segs = recipe(u, d, extra);
    if (!closeTurning(segs, d)) { why("turning"); continue; }
    // Each extra bump (the run's corner ramp) earns a little more lap; the rest
    // of its road comes out of the main straights.
    const grow = 1 + GROW[family] * extra, lo = LAP[family][0] * grow, hi = LAP[family][1] * grow;
    fitLength(segs, u(lo, hi));
    const gap = closeLap(segs, d, why);
    if (!gap) { why("heading"); continue; }
    // lap length into the band: up freely, down only while every corner stays drivable
    let total = 0;
    for (const s of segs) total += segLen(s);
    const min = lo * 0.93, max = hi * 1.1;
    const k0 = total < min ? min / total : total > max ? max / total : 1;
    if (total * k0 > LAP_CAP) { why("long"); if (extra > 0) extra--; continue; }   // too long: back off the extras
    if (k0 !== 1) for (const s of segs) { if (s.R) s.R *= k0; else s.L *= k0; }
    if (!drivable(segs, why)) { why("drivable"); continue; }
    if (Math.hypot(gap.x, gap.y) > SHEAR_MAX * total) { why("position"); continue; }
    // the start line sits on the longest straight, whichever the closure made it
    let at = 0, run = 0, pos = 0;
    for (const s of segs) { if (!s.R && s.L > run) { run = s.L; at = pos + START_AT * s.L; } pos += segLen(s); }
    const shear = { x: gap.x * k0, y: gap.y * k0 };
    // Sampling and the clearance check are the costly part, so the busyness
    // bar (which needs only the segments) goes first.
    const busy = busyness(segs);
    const bar = Math.min(want, DAILY_CORNERS);        // late stages ask for more corners, not a busier bar
    const lazy = busy.turn < BUSY_TURN + BUSY_PER * bar || busy.rev < Math.ceil(bar / 3);
    if (lazy) {
      why("busy");
      if (extra < EXTRA_MAX) extra++;                   // every family's extras add turn-backs
      if (calm && busy.turn <= calm.turn) continue;
    }
    // a layout that can't reach the corner floor, nor beat the best short one, needn't be sampled
    if (!lazy && short && cornerEstimate(segs) < want && cornerEstimate(segs) <= short.corners) { why("corners"); if (extra < EXTRA_MAX) extra++; continue; }
    // a coarse outline catches almost every overlap for a fraction of the cost;
    // its margin (60px under CLEAR) keeps it from rejecting what the full check would pass
    const coarse = outline(segs, 60);
    if (!clear(coarse, total / coarse.length, CLEAR - 60, 1)) { why("clearance"); continue; }
    const t = sample(segs, at, rot, shear);
    if (t.minR <= minR) { why("radius"); continue; }
    if (!clear(t.S)) { why("clearance"); continue; }
    // keep the busiest lazy layout: better than falling back to a harmonic one
    if (lazy) { calm = { segs, at, rot, shear, t, turn: busy.turn }; continue; }
    const corners = cornerCount(t.S);
    const found = { segs, at, rot, shear, t };
    if (corners >= want) return finish(found);
    // Short of the run's corner floor: keep the best such layout in case this
    // family can't carry that many, and try again with another bump.
    why("corners");
    if (!short || corners > short.corners) short = { ...found, corners };
    if (extra < EXTRA_MAX) extra++;
  }
  if (short) return finish(short);
  if (calm) return finish(calm);
  return { ...buildTrack(rng, shape), family: null };
}
