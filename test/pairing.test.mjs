// The client half of device pairing: the new device shows a code and polls
// with its token at a cadence that stays responsive without hammering the
// server; the device with the secret approves by typing the code.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: "", hostname: "example.test", href: "https://example.test/index.html" };
globalThis.document = { hidden: false };

// A scripted server: each path has a queue of replies; every call is logged.
const calls = [];
const replies = { "/pair/start": [], "/pair/poll": [], "/pair/approve": [], "/board": [] };
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname + (new URL(url).search ? "" : "");
  const key = Object.keys(replies).find(p => path.startsWith(p));
  calls.push({ path: key, body: init.body ? JSON.parse(init.body) : null });
  const next = replies[key].length > 1 ? replies[key].shift() : replies[key][0];
  if (!next) return { ok: false, status: 500, json: async () => null };
  return { ok: next.status < 400, status: next.status, json: async () => next.body };
};
replies["/board"].push({ status: 200, body: { top: [], me: null, rankCap: 100 } });

const { board, startPairing, clearPairing, approvePairingCode, pollDelay } = await import(new URL("../js/net/leaderboard.js", import.meta.url));
const identity = await import(new URL("../js/net/identity.js", import.meta.url));

const TOKEN = "a".repeat(32), SECRET = "b".repeat(32);
const flush = () => new Promise(r => setImmediate(r));
const pollsMade = () => calls.filter(c => c.path === "/pair/poll").length;
const reset = () => { calls.length = 0; for (const k of ["/pair/start", "/pair/poll", "/pair/approve"]) replies[k].length = 0; store.clear(); board.pairing = null; };
const startReply = (now) => ({ status: 200, body: { code: "ABCDEF", token: TOKEN, expires: now + 5 * 60 * 1000 } });

test("pollDelay is 2s for the first minute, then 5s", () => {
  assert.equal(pollDelay(0), 2000);
  assert.equal(pollDelay(59_999), 2000);
  assert.equal(pollDelay(60_000), 5000);
  assert.equal(pollDelay(4 * 60_000), 5000);
});

test("startPairing shows the code, polls with the token, and adopts the secret and name when it arrives", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    reset();
    replies["/pair/start"].push(startReply(Date.now()));
    replies["/pair/poll"].push({ status: 200, body: { status: "pending" } }, { status: 200, body: { status: "pending" } }, { status: 200, body: { status: "ready", secret: SECRET, name: "Ryan" } });

    assert.equal(await startPairing(), true);
    assert.deepEqual(board.pairing, { code: "ABCDEF", token: TOKEN, expires: 1_000_000 + 300_000, status: "waiting" });
    assert.equal(pollsMade(), 0, "nothing is fetched until the first interval");

    mock.timers.tick(2000); await flush();
    assert.equal(pollsMade(), 1);
    assert.deepEqual(calls.find(c => c.path === "/pair/poll").body, { token: TOKEN });
    mock.timers.tick(2000); await flush();
    assert.equal(pollsMade(), 2);
    mock.timers.tick(2000); await flush();
    assert.equal(pollsMade(), 3);
    assert.equal(identity.getSecret(), SECRET, "the delivered secret is this device's now");
    assert.equal(identity.getName(), "Ryan");
    assert.equal(board.pairing, null, "the code goes away once paired");

    mock.timers.tick(10_000); await flush();
    assert.equal(pollsMade(), 3, "polling stops after delivery");
  } finally { mock.timers.reset(); }
});

test("the cadence slows to 5s after the first minute", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    reset();
    replies["/pair/start"].push(startReply(Date.now()));
    replies["/pair/poll"].push({ status: 200, body: { status: "pending" } });
    await startPairing();
    for (let i = 0; i < 30; i++) { mock.timers.tick(2000); await flush(); }
    assert.equal(pollsMade(), 30, "one poll every 2s through the first minute");
    for (let i = 0; i < 10; i++) { mock.timers.tick(1000); await flush(); }
    assert.equal(pollsMade(), 32, "then one every 5s");
    clearPairing();
    mock.timers.tick(10_000); await flush();
    assert.equal(pollsMade(), 32, "clearPairing stops the loop");
  } finally { mock.timers.reset(); }
});

test("an unknown token ends the pairing as expired and stops polling", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    reset();
    replies["/pair/start"].push(startReply(Date.now()));
    replies["/pair/poll"].push({ status: 404, body: { error: "unknown-token" } });
    await startPairing();
    mock.timers.tick(2000); await flush();
    assert.equal(board.pairing.status, "expired");
    mock.timers.tick(10_000); await flush();
    assert.equal(pollsMade(), 1);
  } finally { mock.timers.reset(); }
});

test("a hidden tab keeps the schedule but skips the request", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    reset();
    replies["/pair/start"].push(startReply(Date.now()));
    replies["/pair/poll"].push({ status: 200, body: { status: "pending" } });
    await startPairing();
    document.hidden = true;
    mock.timers.tick(2000); await flush();
    mock.timers.tick(2000); await flush();
    assert.equal(pollsMade(), 0, "no requests while hidden");
    document.hidden = false;
    mock.timers.tick(2000); await flush();
    assert.equal(pollsMade(), 1, "resumes on the next interval once visible");
    clearPairing();
  } finally { document.hidden = false; mock.timers.reset(); }
});

test("approvePairingCode sends the code upper-cased with this device's secret and reports the answer", async () => {
  reset();
  identity.setSecret(SECRET);
  replies["/pair/approve"].push({ status: 200, body: { ok: true } }, { status: 404, body: { error: "unknown-code" } });
  assert.equal(await approvePairingCode(" abcdef "), true);
  assert.deepEqual(calls.find(c => c.path === "/pair/approve").body, { code: "ABCDEF", secret: SECRET });
  assert.equal(await approvePairingCode("ABCDEF"), false, "the server's refusal is reported");
});

test("approving without a secret refuses without calling the server", async () => {
  reset();
  assert.equal(identity.getSecret(), null);
  assert.equal(await approvePairingCode("ABCDEF"), false);
  assert.equal(calls.length, 0, "nothing was sent: a fresh secret would pair nothing worth having");
});
