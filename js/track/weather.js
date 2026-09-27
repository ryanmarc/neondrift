// Whether a track is wet. Pure, like styles.js: no DOM, no params import, so
// the leaderboard worker resolves the weather exactly as the game and replays
// a wet run on a wet road.
//
// Past days stay dry bit for bit: a wet road replays to a different time, so
// turning an old day wet would orphan its board. The worker must be deployed
// before WEATHER_CUTOVER or wet days' posts fail replay.

import { hashStr } from "../core/random.js";
import { dayNumber } from "./styles.js";

/** The first day that can be wet. Earlier days never change. */
export const WEATHER_CUTOVER = "2026-10-01";

const wetRoll = seed => hashStr("wx:" + seed) % 5 === 0;   // about one in five

/**
 * "wet" or "dry" for a seed. A daily and each of its run's stages roll on
 * their own full seed, so a wet daily says nothing about its stages. `rnd-…`
 * (?seed=random) rolls the same way; any other custom string is dry, so
 * custom-seed boards keep their times.
 */
export function weatherFor(seed) {
  const at = seed.indexOf("#run");
  const D = dayNumber(at < 0 ? seed : seed.slice(0, at));
  if (D !== null) return D >= dayNumber(WEATHER_CUTOVER) && wetRoll(seed) ? "wet" : "dry";
  if (seed.startsWith("rnd-")) return wetRoll(seed) ? "wet" : "dry";
  return "dry";
}
