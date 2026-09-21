// Everything that comes from the URL or the calendar. Read once at startup.

export const QS = new URLSearchParams(location.search);

/** Today's date as YYYY-MM-DD in UTC — the daily track is the same for everyone. */
export function todayUtc(d = new Date()) {
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}
export const TODAY = todayUtc();

/** The first day the game had a leaderboard. Browsing back stops here; earlier boards are empty. */
export const FIRST_DAY = "2026-09-19";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a seed that is a real calendar day in the daily-seed format (zero-padded UTC date). */
export function isDateSeed(seed) {
  const m = DATE_RE.exec(seed || "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return todayUtc(d) === seed;      // rejects Feb 30 and month 13, which Date would silently roll over
}

/** The date seed `days` whole days after `seed` (negative for earlier). */
export function shiftDate(seed, days) {
  const m = DATE_RE.exec(seed);
  return todayUtc(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days)));
}

/** "today", "yesterday", "3 days ago", "tomorrow", "in 4 days"; null when the seed isn't a date. */
export function describeDay(seed, today = todayUtc()) {
  if (!isDateSeed(seed)) return null;
  const toMs = s => { const m = DATE_RE.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  const n = Math.round((toMs(seed) - toMs(today)) / 86400000);
  if (n === 0) return "today";
  if (n === -1) return "yesterday";
  if (n === 1) return "tomorrow";
  return n < 0 ? (-n) + " days ago" : "in " + n + " days";
}

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

// ?rival=<player id> — a challenge link: race that player's posted run on the
// linked seed. Read once by net/leaderboard.js, which then strips it.
export const RIVAL_PARAM = QS.get("rival");

// FEATURE FLAG: drift guide markers. Off by default. Flip to true here to bring
// them back (which also restores the on-screen toggle button), or append ?guides
// to the page URL to enable them without editing this file.
export const GUIDES_FLAG = false || QS.has("guides");

// FEATURE FLAG: the dev panel (seed loader, guides checkbox) on the start
// screen. Hidden by default; flip to true here or append ?dev to the URL.
export const DEV_FLAG = false || QS.has("dev");

// Leaderboard API. Served from localhost the game talks to the local worker
// (`cd worker && npm run dev`), which has its own simulated database; anywhere
// else it uses the deployed one. Empty string disables the leaderboard entirely.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const API_URL = LOCAL ? "http://localhost:8787" : "https://neondrift-api.rolux.workers.dev";
