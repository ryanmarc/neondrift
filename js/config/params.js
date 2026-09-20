// Everything that comes from the URL or the calendar. Read once at startup.

export const QS = new URLSearchParams(location.search);

/** Today's date as YYYY-MM-DD in UTC — the daily track is the same for everyone. */
export function todayUtc(d = new Date()) {
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}
export const TODAY = todayUtc();

/** Milliseconds until the next midnight UTC, when the daily track changes. */
export function msUntilRollover(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** "4 hours and 32 minutes", "12 minutes", "less than a minute". */
export function describeUntilRollover(now = new Date()) {
  const mins = Math.floor(msUntilRollover(now) / 60000);
  if (mins < 1) return "less than a minute";
  const h = Math.floor(mins / 60), m = mins % 60;
  const hours = h === 1 ? "1 hour" : h + " hours";
  const minutes = m === 1 ? "1 minute" : m + " minutes";
  return h ? hours + " and " + minutes : minutes;
}

// ?seed=2026-12-25 forces that day's track. ?seed=random gives a fresh one every
// load. Any string works — it's only ever used as a seed, so ?seed=abc is valid too.
const SEED_PARAM = QS.get("seed");
export const SEED_OVERRIDE = SEED_PARAM != null && SEED_PARAM !== "";
export const INITIAL_SEED = !SEED_OVERRIDE
  ? TODAY
  : SEED_PARAM === "random" ? "rnd-" + Math.random().toString(36).slice(2, 10) : SEED_PARAM;

// FEATURE FLAG: drift guide markers. Off by default. Flip to true here to bring
// them back (which also restores the on-screen toggle button), or append ?guides
// to the page URL to enable them without editing this file.
export const GUIDES_FLAG = false || QS.has("guides");

// FEATURE FLAG: the dev panel (seed loader, guides checkbox) on the start
// screen. Hidden by default; flip to true here or append ?dev to the URL.
export const DEV_FLAG = false || QS.has("dev");

// Leaderboard API. Empty string disables the leaderboard entirely.
export const API_URL = "https://neondrift-api.rolux.workers.dev";
