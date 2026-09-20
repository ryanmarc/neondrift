// Everything that comes from the URL or the calendar. Read once at startup.

export const QS = new URLSearchParams(location.search);

const now = new Date();
export const TODAY =
  now.getFullYear() + "-" +
  String(now.getMonth() + 1).padStart(2, "0") + "-" +
  String(now.getDate()).padStart(2, "0");

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
