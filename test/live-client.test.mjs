// The live client's socket (js/live/socket.js): how the URL is built, when it
// gives up, when it retries and when it stops for good. live.js itself pulls
// in the renderer and DOM, so its decisions are tested in live-clock.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.location = { search: "", hostname: "localhost" };
globalThis.addEventListener = () => {};
const fakeEl = () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
globalThis.document = { getElementById: fakeEl, addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { wsUrl, connect } = await import(new URL("live/socket.js", root));

test("the socket URL follows the API's scheme", () => {
  assert.equal(wsUrl("http://localhost:8787", "room-1"), "ws://localhost:8787/live/room/room-1");
  assert.equal(wsUrl("https://api.example.dev", "room-12"), "wss://api.example.dev/live/room/room-12");
});

/** A fake WebSocket class whose instances the test drives by hand. */
function fakeSockets() {
  const made = [];
  class WS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; made.push(this); }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.readyState = 3; }
    _open() { this.readyState = 1; this.onopen(); }
    _message(m) { this.onmessage({ data: JSON.stringify(m) }); }
    _close(code) { this.readyState = 3; this.onclose({ code }); }
  }
  return { WS, made };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const wait = ms => new Promise(r => setTimeout(r, ms));

test("the socket gives up at once if the first join fails, with no retry", async () => {
  const statuses = [];
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("down"); };
  const c = connect(() => ({ t: "hello" }), { onMessage() {}, onStatus: s => statuses.push(s) });
  try {
    await tick(); await tick();
    assert.deepEqual(statuses, ["joining", "unavailable"]);
    await wait(300);
    assert.equal(calls, 1);
  } finally { c.close(); }
});

test("a drop retries with backoff, and reconnects", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const statuses = [];
  const c = connect(() => ({ t: "hello", secret: "s" }), { onMessage() {}, onStatus: s => statuses.push(s) }, { baseMs: 200 });
  try {
    await tick(); await tick();
    made[0]._open();
    assert.deepEqual(made[0].sent, [{ t: "hello", secret: "s" }]);
    made[0]._close(1006);
    assert.equal(statuses.at(-1), "offline");
    await wait(250);
    await tick();
    assert.equal(made.length, 2, "reconnected after the backoff");
  } finally { c.close(); }
});

test("reconnect backoff keeps growing while nothing is ever heard back (never hammers the join endpoint)", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const c = connect(() => ({ t: "hello" }), { onMessage() {}, onStatus() {} }, { baseMs: 200 });
  try {
    await tick(); await tick();
    made[0]._open();
    made[0]._close(1006);                       // never received a message: this retry still uses baseMs
    await wait(250);
    await tick();
    assert.equal(made.length, 2, "reconnected after the first (unchanged) backoff");
    made[1]._open();
    made[1]._close(1006);                       // still never heard anything: the NEXT retry is now doubled
    await wait(250);
    await tick();
    assert.equal(made.length, 2, "not yet reconnected: the backoff has doubled to ~400ms");
    await wait(300);
    await tick();
    assert.equal(made.length, 3, "reconnected once the doubled backoff elapsed");
  } finally { c.close(); }
});

test("once backoff has grown, a welcome (a message actually heard) resets it back to the base", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const c = connect(() => ({ t: "hello" }), { onMessage() {}, onStatus() {} }, { baseMs: 200 });
  try {
    await tick(); await tick();
    made[0]._open();
    made[0]._close(1006);                       // never heard anything: backoff grows to ~400ms for the next retry
    await wait(250);
    await tick();
    assert.equal(made.length, 2);
    made[1]._open();
    made[1]._message({ t: "welcome", now: Date.now(), round: 0, standings: [], peers: [] });   // heard: backoff resets to baseMs
    made[1]._close(1006);
    await wait(250);                            // within the reset baseMs window, well under the un-reset ~400ms
    await tick();
    assert.equal(made.length, 3, "reconnected at baseMs, not the previously-grown backoff");
  } finally { c.close(); }
});

test("close code 1008 (a deliberate protocol verdict) is final: no reconnect", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const statuses = [];
  const c = connect(() => ({ t: "hello" }), { onMessage() {}, onStatus: s => statuses.push(s) }, { baseMs: 100 });
  try {
    await tick(); await tick();
    made[0]._open();
    made[0]._close(1008);
    assert.equal(statuses.at(-1), "unavailable");
    await wait(400);
    assert.equal(made.length, 1, "no reconnect after a protocol violation");
  } finally { c.close(); }
});

test("close code 4001 (room full) retries only after the backoff, not at once", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const statuses = [];
  const c = connect(() => ({ t: "hello" }), { onMessage() {}, onStatus: s => statuses.push(s) }, { baseMs: 200 });
  try {
    await tick(); await tick();
    made[0]._open();
    made[0]._close(4001);
    assert.equal(made.length, 1, "not reconnected synchronously");
    assert.equal(statuses.at(-1), "offline");
    await wait(80);
    assert.equal(made.length, 1, "still waiting out the backoff");
    await wait(250);
    await tick();
    assert.equal(made.length, 2, "reconnected once the backoff elapsed");
  } finally { c.close(); }
});

test("replaced by another tab (4000) stops for good", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const statuses = [];
  const c = connect(() => ({ t: "hello", secret: "s" }), { onMessage() {}, onStatus: s => statuses.push(s) }, { baseMs: 100 });
  try {
    await tick(); await tick();
    made[0]._open();
    made[0]._close(4000);
    assert.equal(statuses.at(-1), "displaced");
    await wait(400);
    assert.equal(made.length, 1, "no reconnect after being replaced");
  } finally { c.close(); }
});
