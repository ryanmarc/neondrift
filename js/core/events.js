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
//   race-finish ({ time, prevBest, isPB })
//   track-loaded
//   input-mode ("pointer" | "keys")
//   board-updated       – leaderboard state changed (net/leaderboard.js)
//   line-updated        – optimal line status changed (sim/line.js)
//   challenge ({ name, tag, time }) – a challenge link's ghost is loaded and racing
//   run-start  ({ day })          – a run began (run/run.js)
//   stage-start (n)               – stage n's physics is about to start
//   stage-clear ({ stage, bonus }) – a stage was finished; bonus seconds added
//   offer ({ cleared, bonus, mods }) – the offer screen should show these mod ids
//   run-over ({ score, best, isBest, picks }) – the timer hit zero
//   timer-low                     – the clock dipped under TIMER.low

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
