// Which generator a seed gets, and which layout family. Pure: no DOM, no
// params import, so the leaderboard worker resolves a seed exactly as the game.
//
// Past days keep the harmonic generator bit for bit: their track ids key every
// ghost, cached line and leaderboard row. From CUTOVER on, date seeds (and their
// run stages) get a drift layout. The worker replays through the same code, so
// it must be deployed before CUTOVER or posts on that day fail with
// track-mismatch.

import { mulberry32, hashStr } from "../core/random.js";

/** The first day built from drift layouts. Earlier days never change. */
export const CUTOVER = "2026-09-27";

/** The layout families (see layouts.js). Order is only the shuffle's input. */
export const FAMILIES = ["entry", "technical", "bank", "loop", "touge", "flow"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days since 1970-01-01 for a real zero-padded UTC date, else null. */
function dayNumber(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  const back = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  return back === s ? Math.round(ms / 86400000) : null;   // rejects Feb 30, which Date rolls over
}

/**
 * The i-th entry of an endless walk through the families for `key`: shuffled
 * blocks of all of them, so each block shows every family once, and a block
 * never starts with the family the previous one ended on. `before` is the
 * family that precedes the walk (the day's daily, for its run's stages).
 */
export function walk(key, i, before = null) {
  const F = FAMILIES.length;
  const block = b => {
    const p = FAMILIES.slice(), rng = mulberry32(hashStr(key + ":" + b));
    for (let k = F - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [p[k], p[j]] = [p[j], p[k]]; }
    return p;
  };
  const b = Math.floor(i / F), p = block(b);
  // Only slots 0 and 1 are ever swapped, so the previous block's last slot is its shuffled one.
  const prev = b > 0 ? block(b - 1)[F - 1] : before;
  if (p[0] === prev) [p[0], p[1]] = [p[1], p[0]];
  return p[i - b * F];
}

/**
 * The layout family for a seed, or null for the legacy harmonic generator.
 * "2026-10-04" is a daily: the days from CUTOVER walk the families, so every
 * six days show all six and no two days running share one. "2026-10-04#run3"
 * is stage 3 of that day's run: the same walk seeded by the day, so back to
 * back stages always differ, and stage 1 differs from the daily;
 * "rnd-…" (?seed=random) picks by hash; any other string stays legacy so
 * custom-seed boards keep their tracks.
 */
export function styleFor(seed) {
  const at = seed.indexOf("#run");
  const day = at < 0 ? seed : seed.slice(0, at);
  const stage = at < 0 ? 0 : parseInt(seed.slice(at + 4), 10);
  const D = dayNumber(day);
  if (D !== null) {
    if (D < dayNumber(CUTOVER)) return null;
    const daily = walk("daily", D - dayNumber(CUTOVER));
    return stage > 0 ? walk(day, stage - 1, daily) : daily;   // a run never opens on the daily's family
  }
  if (seed.startsWith("rnd-")) return FAMILIES[hashStr(seed) % FAMILIES.length];
  return null;
}
