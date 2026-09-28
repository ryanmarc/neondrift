// sin, cos, atan2, acos and hypot that return the same bits in every browser.
//
// The spec lets each engine round Math.sin and friends its own way, and they
// do: Firefox and Chrome disagree in the last bit on thousands of the calls a
// track build makes, and the layout search turns that into a different track —
// 2026-09-28 built 112VFL5 in Chrome and 1G0U22H in Firefox, whose posts then
// failed replay with track-mismatch. Everything here is +, -, *, / and
// Math.sqrt, which IEEE 754 fixes exactly, so the result can't depend on the
// engine. The track builders use these; the physics doesn't need to (a replay
// already matches across engines within the worker's tolerances).
//
// sin, cos, atan2 and acos are fdlibm 5.3 (e_rem_pio2, k_sin, k_cos, s_atan,
// e_atan2, e_acos); hypot is V8's algorithm. Neither is bit-identical to every
// engine's Math — no choice could be, since the engines disagree — but every
// track id from 2026-09-01 through a year ahead, the gauntlet stages, the live
// rounds and custom seeds builds the same as it did on Math in Chrome, so no
// stored ghost or leaderboard row moved (test/fmath.test.mjs pins them).

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0, LO = 1 - HI;
const high = x => { f64[0] = x; return u32[HI] | 0; };
const low = x => { f64[0] = x; return u32[LO]; };
const withHigh = (h, l) => { u32[HI] = h; u32[LO] = l; return f64[0]; };

// ---- argument reduction: x = n·π/2 + (y0 + y1) ----

const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
// High words of n·π/2 for n = 1..32: where a quick reduction can cancel badly.
const NPIO2_HW = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
  0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
  0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
  0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];
let y0 = 0, y1 = 0;

/** Sets y0, y1 and returns n, for |x| up to 2^19·π/2; null beyond (never reached by a track). */
function remPio2(x) {
  const hx = high(x), ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) {   // |x| < 3π/4
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { y0 = z - PIO2_1T; y1 = (z - y0) - PIO2_1T; }
      else { z -= PIO2_2; y0 = z - PIO2_2T; y1 = (z - y0) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { y0 = z + PIO2_1T; y1 = (z - y0) + PIO2_1T; }
    else { z += PIO2_2; y0 = z + PIO2_2T; y1 = (z - y0) + PIO2_2T; }
    return -1;
  }
  if (ix > 0x413921fb) return null;
  const t = Math.abs(x), n = (t * INVPIO2 + 0.5) | 0, fn = n;
  let r = t - fn * PIO2_1, w = fn * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) y0 = r - w;
  else {
    const j = ix >> 20;
    y0 = r - w;
    let i = j - ((high(y0) >> 20) & 0x7ff);
    if (i > 16) {   // 2nd iteration, good to 118 bits
      let tt = r; w = fn * PIO2_2; r = tt - w; w = fn * PIO2_2T - ((tt - r) - w); y0 = r - w;
      i = j - ((high(y0) >> 20) & 0x7ff);
      if (i > 49) {   // 3rd iteration, 151 bits
        tt = r; w = fn * PIO2_3; r = tt - w; w = fn * PIO2_3T - ((tt - r) - w); y0 = r - w;
      }
    }
  }
  y1 = (r - y0) - w;
  if (hx < 0) { y0 = -y0; y1 = -y1; return -n; }
  return n;
}

// ---- kernels on [-π/4, π/4] ----

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;

function kSin(x, y, iy) {
  if ((high(x) & 0x7fffffff) < 0x3e400000 && (x | 0) === 0) return x;   // |x| < 2^-27
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kCos(x, y) {
  const ix = high(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));   // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : withHigh(ix - 0x00200000, 0);
  return (1 - qx) - ((0.5 * z - qx) - (z * r - x * y));
}

export function sin(x) {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  if (n === null) return Math.sin(x);
  switch (n & 3) {
    case 0: return kSin(y0, y1, 1);
    case 1: return kCos(y0, y1);
    case 2: return -kSin(y0, y1, 1);
    default: return -kCos(y0, y1);
  }
}

export function cos(x) {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  if (n === null) return Math.cos(x);
  switch (n & 3) {
    case 0: return kCos(y0, y1);
    case 1: return -kSin(y0, y1, 1);
    case 2: return -kCos(y0, y1);
    default: return kSin(y0, y1, 1);
  }
}

// ---- inverse trig ----

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

function atan(x) {
  const hx = high(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) {   // |x| >= 2^66
    if (x !== x) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {   // |x| < 0.4375
    if (ix < 0x3e400000) return x;   // |x| < 2^-27
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); }
      else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PI_O_2 = 1.5707963267948965580e+00;

export function atan2(y, x) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x);   // exact special values, same everywhere
  const hx = high(x), lx = low(x), ix = hx & 0x7fffffff;
  const hy = high(y), ly = low(y), iy = hy & 0x7fffffff;
  if (hx === 0x3ff00000 && lx === 0) return atan(y);   // x = 1
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2);
  if ((iy | ly) === 0) return m === 2 ? PI : m === 3 ? -PI : y;   // y = ±0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;           // x = ±0
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { z = PI_O_2 + 0.5 * PI_LO; m &= 1; }   // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0;                   // |y|/x < -2^60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17;
const PS0 = 1.66666666666666657415e-01, PS1 = -3.25565818622400915405e-01, PS2 = 2.01212532134862925881e-01,
  PS3 = -4.00555345006794114027e-02, PS4 = 7.91534994289814532176e-04, PS5 = 3.47933107596021167570e-05;
const QS1 = -2.40339491173441421878e+00, QS2 = 2.02094576023350569471e+00, QS3 = -6.88283971605453293030e-01,
  QS4 = 7.70381505559019352791e-02;
const rp = z => z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
const rq = z => 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));

export function acos(x) {
  const hx = high(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {   // |x| >= 1
    if (ix === 0x3ff00000 && low(x) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {   // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    return PIO2_HI - (x - (PIO2_LO - x * (rp(z) / rq(z))));
  }
  if (hx < 0) {   // x < -0.5
    const z = (1 + x) * 0.5, s = Math.sqrt(z), w = (rp(z) / rq(z)) * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5, s = Math.sqrt(z);   // x > 0.5
  f64[0] = s; u32[LO] = 0; const df = f64[0];
  const c = (z - df * df) / (s + df), w = (rp(z) / rq(z)) * s + c;
  return 2 * (df + w);
}

/** V8's Math.hypot for two arguments: scale by the larger, a compensated sum, sqrt, unscale. */
export function hypot(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  if (a === Infinity || b === Infinity) return Infinity;   // even beside NaN
  if (a !== a || b !== b) return NaN;
  const max = Math.max(a, b);
  if (max === 0) return 0;
  let sum = 0, comp = 0;
  for (const v of [a, b]) {
    const n = v / max, summand = n * n - comp, pre = sum + summand;
    comp = (pre - sum) - summand; sum = pre;
  }
  return Math.sqrt(sum) * max;
}
