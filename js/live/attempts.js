// Pure bookkeeping for laps sent to the room: which are still awaiting a
// verdict from the current socket, and the single fastest lap finished while
// offline. Kept out of live.js so the pairing and keep-fastest rules can be
// tested without a socket or the DOM.

import { open } from "./clock.js";

const MATCH = 0.05;   // seconds: a result belongs to the pending lap within this (the worker's TIME_TOLERANCE)

export function createAttempts() {
  return { pending: [], queued: null };
}

/** A lap was sent to the room; remember it awaiting a verdict. */
export function recordSent(s, { time, rec }) {
  s.pending.push({ time, rec });
}

/** No connection to send to: keep only the fastest lap finished while offline. */
export function queueOffline(s, a) {
  if (!s.queued || a.time < s.queued.time) s.queued = a;
}

/** The offline-queued attempt, if its round can still accept it. Clears it either way. */
export function takeQueued(s, now) {
  const q = s.queued;
  s.queued = null;
  return q && open(q.round, now) ? q : null;
}

/**
 * Pair a room verdict with the lap it's for and remove it from pending.
 * Returns the recording to keep as the ghost when it's an improved, verified
 * best; null otherwise. A rejected (!ok) verdict carries no time to match on,
 * so it clears the oldest lap still awaiting one.
 */
export function onResult(s, m) {
  const i = m.ok ? s.pending.findIndex(p => Math.abs(p.time - m.time) <= MATCH + 1e-9) : -1;   // +epsilon: fp subtraction can put an exact 0.05 a hair over
  if (i >= 0) {
    const [entry] = s.pending.splice(i, 1);
    return m.improved ? entry.rec : null;
  }
  if (!m.ok) s.pending.shift();
  return null;
}

/** A new round, or leaving live mode: nothing sent or queued is still meaningful. */
export function resetAttempts(s) {
  s.pending = []; s.queued = null;
}

/** A fresh socket (welcome): verdicts for laps sent on the old one are lost. The offline queue is untouched — it hasn't been sent yet. */
export function clearPending(s) {
  s.pending = [];
}
