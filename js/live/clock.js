// The live mode's round clock. Rounds are fixed slots of the wall clock, so
// every room and every client agrees on the round and its map without
// asking anyone; the room only supplies the offset between clocks. Pure: the
// worker imports this file too.

/** Round 0 starts here (UTC ms). */
export const LIVE_EPOCH = Date.UTC(2026, 8, 27);
export const SLOT_MS = 195000;     // one round: racing then results
export const RACING_MS = 180000;   // attempts start in this window
export const GRACE_MS = 2000;      // a lap still on track at the buzzer gets this long to finish

export const roundAt = ms => Math.floor((ms - LIVE_EPOCH) / SLOT_MS);
export const roundStart = round => LIVE_EPOCH + round * SLOT_MS;
export const seedFor = round => "live-" + round;

/** Which round `ms` is in, whether it is racing, and seconds left in this phase. */
export function phaseAt(ms) {
  const round = roundAt(ms), into = ms - roundStart(round);
  const racing = into < RACING_MS;
  return { round, racing, left: ((racing ? RACING_MS : SLOT_MS) - into) / 1000 };
}

/** True while an attempt for `round` may still be accepted at `ms`. */
export function open(round, ms) {
  return roundAt(ms) === round && ms - roundStart(round) < RACING_MS + GRACE_MS;
}

/** What a client with `loadedRound`'s map should do at `ms`: load the new round, drive, or wait out the results. */
export function entryAction(loadedRound, ms) {
  const ph = phaseAt(ms);
  if (ph.round !== loadedRound) return "load";
  return ph.racing ? "drive" : "wait";
}
