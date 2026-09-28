// The live mode's mutable state: a leaf module, so the HUD and daily.js can
// read it without importing the live layer's behaviour.

export const live = {
  active: false,
  status: "idle",     // idle | joining | on | offline | unavailable | displaced
  round: -1,          // the round whose map is loaded, -1 before the first
  offset: 0,          // server clock minus Date.now(), from each welcome
  standings: [],      // [{ id, name, tag, time }] for this round, fastest first
  results: null,      // { round, rows } once the room has sent this round's results
  best: null,         // your verified best this round, seconds, or null
  savedSeed: null,    // the track to restore on leave
};

/** The room's clock, as best this client knows it. */
export const serverNow = () => Date.now() + live.offset;
