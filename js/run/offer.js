// Which three mods a stage offers. A pure function of the day, the stage and
// what is held, so everyone gets the same run and a replay can rebuild it.
// Making offers random later means seeding from something else here, nothing
// more.

import { mulberry32, hashStr } from "../core/random.js";
import { MODS, held } from "./mods.js";

export const OFFER_SIZE = 3;
/** A mod you already hold is this many times as likely to come up again, so builds converge. */
export const HELD_WEIGHT = 2;

/** Up to OFFER_SIZE distinct mod ids that can still be picked. Never includes skip. */
export function offerFor(day, stage, picks) {
  const rng = mulberry32(hashStr(day + "#offer" + stage));
  const pool = [];
  for (const m of MODS) {
    const n = held(picks, m.id);
    if (n < m.max) pool.push({ id: m.id, w: n ? HELD_WEIGHT : 1 });
  }
  const out = [];
  while (out.length < OFFER_SIZE && pool.length) {
    let total = 0;
    for (const c of pool) total += c.w;
    let r = rng() * total, i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
    out.push(pool[i].id);
    pool.splice(i, 1);
  }
  return out;
}
