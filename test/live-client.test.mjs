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
    _close(code) { this.readyState = 3; this.onclose({ code }); }
  }
  return { WS, made };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test("the socket gives up at once if the first join fails, with no retry", async () => {
  const statuses = [];
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("down"); };
  connect(() => ({ t: "hello" }), { onMessage() {}, onStatus: s => statuses.push(s) });
  await tick(); await tick();
  assert.deepEqual(statuses, ["joining", "unavailable"]);
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(calls, 1);
});

test("replaced by another tab (4000) stops for good; a drop retries", async () => {
  const { WS, made } = fakeSockets();
  globalThis.WebSocket = WS;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ room: "room-1" }) });
  const statuses = [];
  const c = connect(() => ({ t: "hello", secret: "s" }), { onMessage() {}, onStatus: s => statuses.push(s) });
  await tick(); await tick();
  made[0]._open();
  assert.deepEqual(made[0].sent, [{ t: "hello", secret: "s" }]);
  made[0]._close(1006);
  assert.equal(statuses.at(-1), "offline");
  await new Promise(r => setTimeout(r, 1100));
  await tick();
  assert.equal(made.length, 2, "reconnected after the backoff");
  made[1]._open();
  made[1]._close(4000);
  assert.equal(statuses.at(-1), "displaced");
  await new Promise(r => setTimeout(r, 2100));
  assert.equal(made.length, 2, "no reconnect after being replaced");
  c.close();
});
