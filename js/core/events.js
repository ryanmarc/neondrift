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
