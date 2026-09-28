// Minimal synchronous event bus. Lets the game layer announce things
// ("boost", "race-finish") without importing the audio or DOM code that
// reacts to them — which is also what keeps the module graph free of cycles.
//
// Events currently emitted:
//   boost               – boost ignited
//   chain-break         – chain multiplier lost (above the ×1.4 threshold)
//   off-track  (v)      – car crossed the edge; v = speed fraction 0..1
//   countdown  (n)      – 3, 2, 1, then 0 for "GO"
//   race-start
//   race-finish ({ time, prevBest, isPB, ghost, inputs, practice }) – practice is true for a ?weather override: not saved, not posted
//   track-loaded
//   geometry-loaded ({ seed, id, wet }) – any geometry load, daily or run stage (track/track.js); the music composes on it
//   input-mode ("pointer" | "keys" | "pad")
//   board-updated       – leaderboard state changed (net/leaderboard.js)
//   line-updated        – optimal line status changed (sim/line.js)
//   challenge ({ name, tag, time }) – a challenge link's ghost is loaded and racing
//   run-start  ({ day })          – a run began (run/run.js)
//   stage-start (n)               – stage n's countdown begins (every stage gets the 3-2-1)
//   stage-clear ({ stage, bonus }) – a stage was finished; bonus seconds added
//   offer ({ cleared, bonus, mods }) – the offer screen should show these mod ids
//   run-over ({ score, best, isBest, picks }) – the timer hit zero
//   timer-low                     – the clock dipped under TIMER.low
//   second-wind                   – the clock hit zero and a Second wind refilled it (run/run.js)
//   live-state                    – live status, round or standings changed (live/live.js)
//   live-round (n)                – live round n's map is loaded
//   live-standing ({ id, name, tag, time }) – someone set a verified best this round
//   live-attempt ({ ok, time, improved, reason }) – the room's verdict on your lap
//   live-results ({ round, rows }) – the round's final ranking
//   live-peer-join ({ id, name, tag }) / live-peer-leave ({ id })
//   live-leave                    – left live mode; the daily track is back

const listeners = new Map();

/** Subscribe. Returns an unsubscribe function. */
export function on(name, fn) {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

/** Call every listener for `name`, in subscription order, right now. */
export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) fn(payload);
}
