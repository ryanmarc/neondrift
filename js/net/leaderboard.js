// Leaderboard state for the current track, and the rules for when a run is
// sent: personal bests only, only once a name exists, never blocking play.
// The UI reads `board` and listens for "board-updated".

import { on, emit } from "../core/events.js";
import { track } from "../track/track.js";
import * as api from "./api.js";
import * as identity from "./identity.js";
import * as storage from "../core/storage.js";
import { setRival } from "../game/ghost.js";

export const board = {
  status: api.apiEnabled() ? "loading" : "off",   // off | loading | ready | unavailable
  top: [],            // [{ name, tag, time, at }]
  me: null,           // { rank, time, name, tag } or null; rank > rankCap means "worse than rankCap"
  rankCap: 100,
  pending: null,      // a PB waiting for a name before it can be posted
  lastSubmit: null,   // { accepted, improved, rank, reason } from the last post
  pairing: null,      // { code, expires } while a pairing code is showing
  rival: null,        // { id, name, tag, time, status: loading | ready | failed } — chosen leaderboard ghost
};

const rivalKey = () => "neondrift:t" + track.id + ":rival";
const ghostCache = new Map();   // "trackId/playerId" → fetched ghost, for the session

/** Fetch a leaderboard run and race it; null clears back to your own ghost. */
export async function chooseRival(playerId) {
  if (!playerId) {
    board.rival = null; setRival(null); storage.remove(rivalKey()); changed(); return;
  }
  const id = track.id, key = id + "/" + playerId;
  board.rival = { id: playerId, name: "", tag: playerId.slice(0, 4), time: null, status: "loading" }; changed();
  storage.write(rivalKey(), playerId);
  let g = ghostCache.get(key);
  if (!g) { g = await api.fetchGhost(id, playerId); if (g && !g.error) ghostCache.set(key, g); }
  if (id !== track.id || !board.rival || board.rival.id !== playerId) return;   // changed mind meanwhile
  if (!g || g.error) { board.rival.status = "failed"; setRival(null); changed(); return; }
  board.rival = { id: playerId, name: g.name, tag: g.tag, time: g.time, status: "ready" };
  setRival({ id: playerId, name: g.name, tag: g.tag, time: g.time, data: g.ghost });
  changed();
}

const changed = () => emit("board-updated");

/** Reload the top list and the player's row for the current track. */
export async function refreshBoard() {
  if (!api.apiEnabled()) return;
  const id = track.id;
  board.status = "loading"; changed();
  const data = await api.fetchBoard(id, await identity.playerId());
  if (id !== track.id) return;                 // a different track loaded meanwhile
  if (!data || data.error) { board.status = "unavailable"; changed(); return; }
  board.top = data.top; board.me = data.me; board.rankCap = data.rankCap || 100; board.status = "ready";
  changed();
}

async function submit(payload) {
  const body = {
    secret: identity.ensureSecret(), name: identity.getName(),
    seed: track.seed, trackId: track.id,
    inputs: payload.inputs, ghost: payload.ghost, time: payload.time,
  };
  const res = await api.postRun(body);
  board.lastSubmit = res && !res.error ? res : { accepted: false, reason: res ? res.error : "unavailable" };
  changed();
  await refreshBoard();
}

/** Post the run that is waiting for a name (called once a name is set). */
export async function submitPending() {
  if (!board.pending) return;
  const p = board.pending; board.pending = null; changed();
  await submit(p);
}

export function dismissPending() { board.pending = null; changed(); }

/** Set (or change) the display name and tell the server. Resolves false if rejected. */
export async function setPlayerName(name) {
  const secret = identity.ensureSecret();
  const res = await api.postName(secret, name);
  if (!res || res.error) return false;
  identity.setName(name);
  changed();
  if (board.pending) await submitPending(); else await refreshBoard();
  return true;
}

export async function startPairing() {
  const res = await api.pairStart(identity.ensureSecret());
  if (!res || res.error) return false;
  board.pairing = { code: res.code, expires: res.expires }; changed();
  return true;
}

export function clearPairing() { board.pairing = null; changed(); }

/** Adopt another device's identity from its code. Resolves false if the code is bad. */
export async function claimPairingCode(code) {
  const res = await api.pairClaim(code.trim().toUpperCase());
  if (!res || res.error) return false;
  identity.setSecret(res.secret);
  if (res.name) identity.setName(res.name);
  changed();
  await refreshBoard();
  return true;
}

on("track-loaded", () => {
  board.top = []; board.me = null; board.pending = null; board.lastSubmit = null; board.rival = null;
  refreshBoard();
  const remembered = storage.read(rivalKey());
  if (remembered && api.apiEnabled()) chooseRival(remembered);
});
/**
 * Post a run when it beats your posted time, or you have none posted yet.
 * That is independent of your local ghost, which can be faster than your
 * posted time (a best set before you had a name, or while offline). When the
 * board hasn't loaded, fall back to the local personal-best rule.
 */
function worthPosting(result) {
  if (board.status !== "ready") return result.isPB;
  return board.me == null || result.time < board.me.time;
}

on("race-finish", (result) => {
  if (!api.apiEnabled() || !worthPosting(result)) return;
  if (identity.getName()) submit(result);
  else { board.pending = result; changed(); }
});
