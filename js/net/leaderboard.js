// Leaderboard state for the current track, and the rules for when a run is
// sent: personal bests only, only once a name exists, never blocking play.
// The UI reads `board` and listens for "board-updated".

import { on, emit } from "../core/events.js";
import { track } from "../track/track.js";
import * as api from "./api.js";
import * as identity from "./identity.js";

export const board = {
  status: api.apiEnabled() ? "loading" : "off",   // off | loading | ready | unavailable
  top: [],            // [{ name, tag, time, at }]
  me: null,           // { rank, time, name, tag } or null; rank > rankCap means "worse than rankCap"
  rankCap: 100,
  pending: null,      // a PB waiting for a name before it can be posted
  lastSubmit: null,   // { accepted, improved, rank, reason } from the last post
  pairing: null,      // { code, expires } while a pairing code is showing
};

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

on("track-loaded", () => { board.top = []; board.me = null; board.pending = null; board.lastSubmit = null; refreshBoard(); });
on("race-finish", (result) => {
  if (!api.apiEnabled() || !result.isPB) return;
  if (identity.getName()) submit(result);
  else { board.pending = result; changed(); }
});
