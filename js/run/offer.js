// Which three mods a stage offers. A pure function of the day, the stage and
// what is held, so everyone gets the same run and a replay can rebuild it.
// Making offers random later means seeding from something else here, nothing
// more.

import { mulberry32, hashStr } from "../core/random.js";
import { MODS, held } from "./mods.js";

export const OFFER_SIZE = 3;
/** A mod you already hold is this many times as likely to come up again, so builds converge. */
export const HELD_WEIGHT = 2;
/** Pure upsides at half weight: they fill an offer, they don't define a build. */
export const PURE_WEIGHT = 0.5;

const CAR = new Set(["car", "character"]);

/**
 * Up to OFFER_SIZE distinct mod ids that can still be picked. Never includes
 * skip. Slot one is a car or character card while any remain, so no offer is
 * dead for feel; character cards are weighted like held ones until one is
 * held, so a build finds its spine early.
 */
export function offerFor(day, stage, picks) {
  const rng = mulberry32(hashStr(day + "#offer" + stage));
  const anyCharacter = MODS.some(m => m.kind === "character" && held(picks, m.id) > 0);
  const pool = [];
  for (const m of MODS) {
    const n = held(picks, m.id);
    if (n >= m.max) continue;
    const w = n ? HELD_WEIGHT : m.kind === "pure" ? PURE_WEIGHT : (m.kind === "character" && !anyCharacter) ? HELD_WEIGHT : 1;
    pool.push({ id: m.id, kind: m.kind, w });
  }
  const draw = (cands) => {
    let total = 0;
    for (const c of cands) total += c.w;
    let r = rng() * total, i = 0;
    while (i < cands.length - 1 && r >= cands[i].w) { r -= cands[i].w; i++; }
    const c = cands[i];
    pool.splice(pool.indexOf(c), 1);
    return c.id;
  };
  const out = [];
  const cars = pool.filter(c => CAR.has(c.kind));
  if (cars.length) out.push(draw(cars));
  while (out.length < OFFER_SIZE && pool.length) out.push(draw(pool));
  return out;
}
