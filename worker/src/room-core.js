// A live room's rules, as pure functions over a plain state object: who is
// here, what is relayed, which attempts rank. The Durable Object (live.js)
// is a shell that feeds messages in and sends what comes out, so all of this
// is testable in Node without the Workers runtime.
//
// Outbound messages are { to, msg }: to is "all", "others" (everyone but the
// sender) or one player id.

import { roundAt, seedFor, open } from "../../js/live/clock.js";
import { validInputs, validTime, cleanName } from "./validate.js";

export const ROOM_CAP = 16;
export const POSE_PER_S = 15;          // clients send 10Hz; headroom for jitter
export const ATTEMPT_GAP_MS = 5000;    // a lap is ~12s+, so this only stops scripts
export const STRIKES_MAX = 20;         // dropped messages before the socket is closed

export function createRoom() {
  return { round: -1, best: new Map(), players: new Map(), limits: new Map() };
}

const info = p => ({ id: p.id, name: p.name, tag: p.tag });

/** Clear the standings when the wall clock has moved into a new round. */
export function rollRound(room, now) {
  const r = roundAt(now);
  if (r !== room.round) { room.round = r; room.best = new Map(); room.limits = new Map(); }
}

export function standings(room) {
  return [...room.best.values()]
    .sort((a, b) => a.time - b.time || a.at - b.at)
    .map(({ id, name, tag, time }) => ({ id, name, tag, time }));
}

/** The name a player shows under: D1's if they have posted, else what they sent if valid, else Guest. */
export function nameFor(stored, sent) {
  return stored || cleanName(sent) || "Guest";
}

export function join(room, id, name, now) {
  rollRound(room, now);
  const replaced = room.players.has(id);
  if (!replaced && room.players.size >= ROOM_CAP) return { ok: false, replaced: false, out: [] };
  const p = { id, name, tag: id.slice(0, 4), poses: [], lastSeen: now };
  room.players.set(id, p);
  if (!room.limits.has(id)) room.limits.set(id, { lastAttempt: -Infinity, strikes: 0 });
  const peers = [...room.players.values()].filter(q => q.id !== id).map(info);
  const out = [{ to: id, msg: { t: "welcome", now, round: room.round, standings: standings(room), peers } }];
  if (!replaced) out.push({ to: "others", msg: { t: "join", ...info(p) } });
  return { ok: true, replaced, out };
}

export function leave(room, id) {
  if (!room.players.delete(id)) return [];
  return [{ to: "others", msg: { t: "leave", id } }];
}

const finite4 = p => Array.isArray(p) && p.length === 4 && p.every(x => typeof x === "number" && Number.isFinite(x));

export function handle(room, id, msg, now, verify) {
  rollRound(room, now);
  const p = room.players.get(id);
  const none = { out: [], dirty: false, close: false };
  if (!p) return none;
  let lim = room.limits.get(id);
  // A roll clears the limits of players still in the room: keep the fresh
  // record, or its strikes would start over on every message.
  if (!lim) { lim = { lastAttempt: -Infinity, strikes: 0 }; room.limits.set(id, lim); }
  const strike = () => { lim.strikes++; return { out: [], dirty: false, close: lim.strikes > STRIKES_MAX }; };
  if (!msg || typeof msg !== "object") return strike();

  if (msg.t === "pose") {
    if (!finite4(msg.p)) return strike();
    while (p.poses.length && p.poses[0] <= now - 1000) p.poses.shift();
    if (p.poses.length >= POSE_PER_S) return strike();
    p.poses.push(now);
    p.lastSeen = now;
    return { out: [{ to: "others", msg: { t: "pose", id, p: msg.p } }], dirty: false, close: false };
  }

  if (msg.t === "attempt") {
    p.lastSeen = now;
    const refuse = reason => ({ out: [{ to: id, msg: { t: "attempt-result", ok: false, reason } }], dirty: false, close: false });
    if (!validInputs(msg.inputs) || !validTime(msg.time)) { lim.strikes++; return refuse("invalid"); }
    if (msg.round !== room.round || !open(room.round, now)) return refuse("closed");
    if (now - lim.lastAttempt < ATTEMPT_GAP_MS) { lim.strikes++; return refuse("rate"); }
    lim.lastAttempt = now;
    const r = verify(seedFor(room.round), msg.inputs, msg.time);
    if (!r.ok) return refuse(r.reason || "rejected");
    const prev = room.best.get(id);
    const improved = !prev || r.time < prev.time;
    const out = [{ to: id, msg: { t: "attempt-result", ok: true, time: r.time, improved } }];
    if (improved) {
      room.best.set(id, { id, name: p.name, tag: p.tag, time: r.time, at: now });
      out.push({ to: "all", msg: { t: "standing", id, name: p.name, tag: p.tag, time: r.time } });
    }
    return { out, dirty: improved, close: false };
  }

  return strike();
}

/** Players not seen (joined, an accepted pose, an attempt) for longer than maxMs. */
export function idle(room, now, maxMs) {
  return [...room.players.values()].filter(p => now - p.lastSeen > maxMs).map(p => p.id);
}

export function resultsMsg(room) {
  return { t: "results", round: room.round, rows: standings(room) };
}

/** What goes to Durable Object storage: enough to rebuild the standings after an eviction. */
export function snapshot(room) {
  return { round: room.round, rows: [...room.best.values()] };
}

export function restore(room, snap) {
  if (!snap || !Array.isArray(snap.rows)) return;
  room.round = snap.round;
  room.best = new Map(snap.rows.map(r => [r.id, r]));
}
