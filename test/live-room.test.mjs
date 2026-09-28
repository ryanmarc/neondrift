// The live room's rules (worker/src/room-core.js): who is here, who is
// fastest, what gets relayed, what is refused. The Durable Object is a thin
// shell over these functions.
import { test } from "node:test";
import assert from "node:assert/strict";

const R = await import(new URL("../worker/src/room-core.js", import.meta.url));
const { roundStart, RACING_MS, GRACE_MS, seedFor } = await import(new URL("../js/live/clock.js", import.meta.url));

const A = "a".repeat(64), B = "b".repeat(64);
const T0 = roundStart(100) + 10000;                 // 10s into round 100
const INPUTS = [0, 1, 120, 0];
const pass = (seed, inputs, time) => ({ ok: true, time });
const fail = () => ({ ok: false, time: 0, reason: "time-mismatch" });
const attempt = (time, round = 100) => ({ t: "attempt", round, inputs: INPUTS, time });

function roomWith(...ids) {
  const room = R.createRoom();
  for (const id of ids) R.join(room, id, "P" + id[0], T0);
  return room;
}

test("a join is welcomed with the clock, round, standings and who else is here", () => {
  const room = roomWith(A);
  const r = R.join(room, B, "Bee", T0);
  assert.equal(r.ok, true); assert.equal(r.replaced, false);
  const welcome = r.out.find(o => o.to === B).msg;
  assert.equal(welcome.t, "welcome");
  assert.equal(welcome.now, T0);
  assert.equal(welcome.round, 100);
  assert.deepEqual(welcome.peers, [{ id: A, name: "Pa", tag: "aaaa" }]);
  const j = r.out.find(o => o.to === "others");
  assert.deepEqual(j.msg, { t: "join", id: B, name: "Bee", tag: "bbbb" });
});

test("the room is full at 16, but a rejoin by someone already in is not refused", () => {
  const room = R.createRoom();
  for (let i = 0; i < R.ROOM_CAP; i++) assert.equal(R.join(room, i.toString(16).padStart(64, "0"), "x", T0).ok, true);
  assert.equal(R.join(room, B, "late", T0).ok, false);
  const again = R.join(room, "0".repeat(64), "x", T0);
  assert.equal(again.ok, true);
  assert.equal(again.replaced, true);
  assert.ok(!again.out.some(o => o.msg.t === "join"), "a replaced socket is not a new arrival");
});

test("leaving tells the others", () => {
  const room = roomWith(A, B);
  assert.deepEqual(R.leave(room, A), [{ to: "others", msg: { t: "leave", id: A } }]);
  assert.deepEqual(R.leave(room, A), []);
});

test("a verified attempt ranks and is broadcast; a slower one does not replace it", () => {
  const room = roomWith(A, B);
  let r = R.handle(room, A, attempt(14.2), T0, pass);
  assert.equal(r.dirty, true);
  assert.deepEqual(r.out.find(o => o.to === A).msg, { t: "attempt-result", ok: true, time: 14.2, improved: true });
  assert.deepEqual(r.out.find(o => o.to === "all").msg, { t: "standing", id: A, name: "Pa", tag: "aaaa", time: 14.2 });
  r = R.handle(room, A, attempt(15), T0 + 6000, pass);
  assert.equal(r.dirty, false);
  assert.equal(r.out.find(o => o.to === A).msg.improved, false);
  assert.ok(!r.out.some(o => o.to === "all"));
  R.handle(room, B, attempt(13.9), T0 + 7000, pass);
  assert.deepEqual(R.standings(room).map(s => [s.id, s.time]), [[B, 13.9], [A, 14.2]]);
});

test("the verifier gets the round's seed; a failed replay doesn't rank", () => {
  const room = roomWith(A);
  let seen = null;
  R.handle(room, A, attempt(14), T0, (seed, inputs, time) => { seen = [seed, inputs, time]; return fail(); });
  assert.deepEqual(seen, [seedFor(100), INPUTS, 14]);
  assert.deepEqual(R.standings(room), []);
});

test("attempts are refused for another round, after the grace, too often, or malformed", () => {
  const room = roomWith(A);
  const reason = (msg, now) => R.handle(room, A, msg, now, pass).out[0].msg.reason;
  assert.equal(reason(attempt(14, 99), T0), "closed");
  assert.equal(reason(attempt(14), roundStart(100) + RACING_MS + GRACE_MS), "closed");
  assert.equal(reason({ t: "attempt", round: 100, inputs: [0, 5], time: 14 }, T0), "invalid");
  assert.equal(reason({ t: "attempt", round: 100, inputs: INPUTS, time: -1 }, T0), "invalid");
  R.handle(room, A, attempt(14), T0 + 100000, pass);
  assert.equal(reason(attempt(13), T0 + 101000), "rate");
});

test("poses are relayed to the others, capped at 15 a second, and must be finite", () => {
  const room = roomWith(A, B);
  const p = [10, 20, 0.5, 0.25];
  assert.deepEqual(R.handle(room, A, { t: "pose", p }, T0, pass).out, [{ to: "others", msg: { t: "pose", id: A, p } }]);
  for (let i = 1; i < R.POSE_PER_S; i++) assert.equal(R.handle(room, A, { t: "pose", p }, T0 + i, pass).out.length, 1);
  assert.equal(R.handle(room, A, { t: "pose", p }, T0 + 20, pass).out.length, 0, "the 16th in a second is dropped");
  assert.equal(R.handle(room, A, { t: "pose", p }, T0 + 1001, pass).out.length, 1, "a new second, a new budget");
  assert.equal(R.handle(room, B, { t: "pose", p: [1, 2, NaN, 0] }, T0, pass).out.length, 0);
  assert.equal(R.handle(room, B, { t: "pose", p: [1, 2, 3] }, T0, pass).out.length, 0);
});

test("repeated garbage closes the socket", () => {
  const room = roomWith(A);
  let r;
  for (let i = 0; i <= R.STRIKES_MAX; i++) r = R.handle(room, A, { t: "nonsense" }, T0 + i, pass);
  assert.equal(r.close, true);
});

test("a new round clears the standings; results carry the round and rows", () => {
  const room = roomWith(A);
  R.handle(room, A, attempt(14), T0, pass);
  assert.deepEqual(R.resultsMsg(room), { t: "results", round: 100, rows: [{ id: A, name: "Pa", tag: "aaaa", time: 14 }] });
  R.rollRound(room, roundStart(101));
  assert.deepEqual(R.resultsMsg(room), { t: "results", round: 101, rows: [] });
});

test("standings survive a snapshot and restore (an evicted room)", () => {
  const room = roomWith(A);
  R.handle(room, A, attempt(14), T0, pass);
  const fresh = R.createRoom();
  R.restore(fresh, JSON.parse(JSON.stringify(R.snapshot(room))));
  R.rollRound(fresh, T0 + 1000);
  assert.deepEqual(R.standings(fresh), R.standings(room));
});

test("a player with no stored name and no valid sent name is a Guest", () => {
  assert.equal(R.nameFor("Stored", "Sent"), "Stored");
  assert.equal(R.nameFor(null, "Sent Name"), "Sent Name");
  assert.equal(R.nameFor(null, ""), "Guest");
  assert.equal(R.nameFor(null, "<script>"), "Guest");
  assert.equal(R.nameFor(null, undefined), "Guest");
});
