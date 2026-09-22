// Stage seeds, scores and the storage keys. Pure.

/** Stage n of a day is its own track: a distinct geometry from the daily one and every other stage. */
export const stageSeed = (day, n) => day + "#run" + n;

/** Does score a beat score b? More stages cleared, then further into the fatal stage. Anything beats null. */
export function beats(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  return a.stages !== b.stages ? a.stages > b.stages : a.prog > b.prog;
}

/** A stored score, or null if the JSON is missing, corrupt or not a score. */
export function parseBest(json) {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v) || !Number.isFinite(v.stages)) return null;
    return { ...v, stages: v.stages, prog: Number.isFinite(v.prog) ? v.prog : 0, picks: Array.isArray(v.picks) ? v.picks : [] };
  } catch { return null; }
}

export const bestKeyDay = day => "neondrift:run:" + day + ":best";
export const BEST_KEY_ALL = "neondrift:run:best";
