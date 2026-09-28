// Pure bookkeeping for laps sent to the room (js/live/attempts.js): pairing a
// verdict with the lap it verifies, and the single fastest lap kept while
// offline. No DOM, no sockets — live.js just calls these.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAttempts, recordSent, queueOffline, takeQueued, onResult, resetAttempts, clearPending,
} from "../js/live/attempts.js";
import { roundStart, RACING_MS, GRACE_MS } from "../js/live/clock.js";

test("onResult pairs by time within MATCH (0.05), inclusive at the boundary", () => {
  const s = createAttempts();
  recordSent(s, { time: 20.00, rec: "A" });
  const rec = onResult(s, { ok: true, improved: true, time: 20.05 });   // exactly 0.05 away
  assert.equal(rec, "A");
  assert.equal(s.pending.length, 0, "the matched lap is removed");
});

test("onResult just outside the boundary does not pair", () => {
  const s = createAttempts();
  recordSent(s, { time: 20.00, rec: "A" });
  const rec = onResult(s, { ok: true, improved: true, time: 20.06 });
  assert.equal(rec, null);
  assert.equal(s.pending.length, 1, "nothing matched, so nothing was removed");
});

test("a matched but non-improved verdict returns null and still removes the pending lap", () => {
  const s = createAttempts();
  recordSent(s, { time: 15.2, rec: "A" });
  const rec = onResult(s, { ok: true, improved: false, time: 15.2 });
  assert.equal(rec, null);
  assert.equal(s.pending.length, 0);
});

test("a rejected (!ok) verdict with no time removes the oldest pending entry", () => {
  const s = createAttempts();
  recordSent(s, { time: 10, rec: "A" });
  recordSent(s, { time: 11, rec: "B" });
  const rec = onResult(s, { ok: false, reason: "tampered" });
  assert.equal(rec, null);
  assert.deepEqual(s.pending, [{ time: 11, rec: "B" }], "the oldest (first sent) was removed");
});

test("onResult matches the first pending entry within range, in send order", () => {
  const s = createAttempts();
  recordSent(s, { time: 20.00, rec: "first" });
  recordSent(s, { time: 20.03, rec: "second" });
  const rec = onResult(s, { ok: true, improved: true, time: 20.02 });
  assert.equal(rec, "first");
});

test("queueOffline keeps only the fastest lap", () => {
  const s = createAttempts();
  queueOffline(s, { round: 3, inputs: [], time: 12.0, rec: "slow" });
  queueOffline(s, { round: 3, inputs: [], time: 9.5, rec: "fast" });
  queueOffline(s, { round: 3, inputs: [], time: 20.0, rec: "slower" });
  assert.equal(s.queued.rec, "fast");
});

test("takeQueued returns the queued attempt when its round is still open, and clears it", () => {
  const s = createAttempts();
  const round = 0;
  queueOffline(s, { round, inputs: [], time: 12.0, rec: "R" });
  const now = roundStart(round) + 1000;   // 1s into round 0's racing window
  const a = takeQueued(s, now);
  assert.equal(a.rec, "R");
  assert.equal(s.queued, null);
});

test("takeQueued refuses (and clears) an attempt whose round has closed", () => {
  const s = createAttempts();
  const round = 0;
  queueOffline(s, { round, inputs: [], time: 12.0, rec: "R" });
  const closed = roundStart(round) + RACING_MS + GRACE_MS + 1000;   // past the grace window
  const a = takeQueued(s, closed);
  assert.equal(a, null);
  assert.equal(s.queued, null, "cleared even though it was refused");
});

test("resetAttempts clears both pending and queued", () => {
  const s = createAttempts();
  recordSent(s, { time: 1, rec: "A" });
  queueOffline(s, { round: 0, inputs: [], time: 2, rec: "B" });
  resetAttempts(s);
  assert.deepEqual(s.pending, []);
  assert.equal(s.queued, null);
});

test("clearPending drops pending verdicts (a fresh socket after a welcome) but leaves queued alone", () => {
  const s = createAttempts();
  recordSent(s, { time: 1, rec: "A" });
  queueOffline(s, { round: 0, inputs: [], time: 2, rec: "B" });
  clearPending(s);
  assert.deepEqual(s.pending, []);
  assert.equal(s.queued.rec, "B", "the offline queue survives — it hasn't been sent yet");
});
