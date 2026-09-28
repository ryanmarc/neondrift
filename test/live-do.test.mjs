// The Room Durable Object shell (worker/src/live.js) against a fake Durable
// Object ctx: no cloudflare:workers import in live.js means node --test can
// drive webSocketMessage / webSocketClose / alarm directly, the same calls
// the real Hibernation API would make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1.mjs";

const { Room, HELLO_MS } = await import("../worker/src/live.js");
const { roundAt } = await import(new URL("../js/live/clock.js", import.meta.url));

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const SECRET_C = "c".repeat(32);

class FakeSocket {
  constructor() {
    this.readyState = 1;   // OPEN
    this.sent = [];
    this.closedWith = null;
    this._att = undefined;
    this._ctx = null;
  }
  send(text) { this.sent.push(text); }
  close(code, reason) {
    if (this.readyState === 3) return;   // idempotent, as a real socket's close is
    this.readyState = 3;
    this.closedWith = { code, reason };
    if (this._ctx) {
      const i = this._ctx.sockets.indexOf(this);
      if (i >= 0) this._ctx.sockets.splice(i, 1);
    }
  }
  serializeAttachment(v) { this._att = v; }
  deserializeAttachment() { return this._att; }
  json(i = 0) { return JSON.parse(this.sent[i]); }
  types() { return this.sent.map(s => JSON.parse(s).t); }
}

class FakeCtx {
  constructor() {
    this.sockets = [];
    this.map = new Map();
    this.alarmAt = null;
    this.storage = {
      get: async (key) => this.map.get(key),
      put: async (key, val) => { this.map.set(key, val); },
      getAlarm: async () => this.alarmAt,
      setAlarm: async (at) => { this.alarmAt = at; },
    };
  }
  getWebSockets() { return this.sockets.slice(); }
  acceptWebSocket(ws) { this.sockets.push(ws); ws._ctx = this; }
  blockConcurrencyWhile(fn) { this.ready = Promise.resolve().then(fn); return this.ready; }
}

async function makeRoom(env = { DB: fakeD1() }) {
  const ctx = new FakeCtx();
  const room = new Room(ctx, env);
  await ctx.ready;
  return { room, ctx };
}

const hello = (room, ws, secret, name) => room.webSocketMessage(ws, JSON.stringify({ t: "hello", secret, name }));

test("hello gets a welcome; a second player's hello notifies the first with join", async () => {
  const { room } = await makeRoom();
  const a = new FakeSocket(); room.accept(a);
  await hello(room, a, SECRET_A, "Alpha");
  assert.equal(a.json(0).t, "welcome");

  const b = new FakeSocket(); room.accept(b);
  await hello(room, b, SECRET_B, "Bravo");
  assert.ok(a.types().includes("join"));
  assert.equal(a.sent.map(s => JSON.parse(s)).find(m => m.t === "join").name, "Bravo");
});

test("a message before hello closes 1008; a bad secret closes 1008", async () => {
  const { room } = await makeRoom();
  const early = new FakeSocket(); room.accept(early);
  await room.webSocketMessage(early, JSON.stringify({ t: "pose", p: [0, 0, 0, 0] }));
  assert.equal(early.closedWith.code, 1008);

  const badSecret = new FakeSocket(); room.accept(badSecret);
  await hello(room, badSecret, "not-a-secret", "Eve");
  assert.equal(badSecret.closedWith.code, 1008);
});

test("the same secret on a second socket closes the first with 4000 and the other player gets no leave", async () => {
  const { room } = await makeRoom();
  const a = new FakeSocket(); room.accept(a);
  await hello(room, a, SECRET_A, "Alpha");
  const b = new FakeSocket(); room.accept(b);
  await hello(room, b, SECRET_B, "Bravo");
  b.sent = [];

  const a2 = new FakeSocket(); room.accept(a2);
  await hello(room, a2, SECRET_A, "Alpha-2");

  assert.equal(a.closedWith.code, 4000);
  assert.ok(!b.types().includes("leave"));
});

/** A DB whose player lookup resolves at once, except while `stall()`'s promise is unresolved. */
function stallableDB() {
  let pending = null;
  return {
    prepare: () => ({ bind: () => ({ first: () => pending || Promise.resolve(null) }) }),
    stall() { let resolve; pending = new Promise(r => { resolve = r; }); return v => { pending = null; resolve(v); }; },
  };
}

test("hello then close before the D1 lookup resolves adds no player and broadcasts nothing", async () => {
  const DB = stallableDB();
  const { room } = await makeRoom({ DB });
  const bystander = new FakeSocket(); room.accept(bystander);
  await hello(room, bystander, SECRET_B, "Bravo");
  bystander.sent = [];

  const resolvePlayerName = DB.stall();
  const ws = new FakeSocket(); room.accept(ws);
  const pending = hello(room, ws, SECRET_A, "Alpha");
  await room.webSocketClose(ws, 1000, "bye");   // the client hangs up while the DB lookup is still in flight
  resolvePlayerName(null);
  await pending;

  assert.equal(room.room.players.size, 1);   // only the bystander
  assert.ok(!bystander.types().includes("join"));
});

test("a D1 failure during hello closes the socket 1011 instead of throwing", async () => {
  const DB = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("boom")) }) }) };
  const { room } = await makeRoom({ DB });
  const ws = new FakeSocket(); room.accept(ws);
  await assert.doesNotReject(hello(room, ws, SECRET_A, "Alpha"));
  assert.equal(ws.closedWith.code, 1011);
  assert.equal(room.room.players.size, 0);
});

test("sweep closes an unhelloed socket past HELLO_MS and leaves a younger one; /count reports open sockets", async () => {
  const { room, ctx } = await makeRoom();
  const base = Date.now();
  const old = new FakeSocket(); room.accept(old, base - HELLO_MS - 1000);
  const young = new FakeSocket(); room.accept(young, base - 2000);

  room.sweep(base);
  assert.equal(old.readyState, 3);
  assert.equal(old.closedWith.code, 1008);
  assert.equal(young.readyState, 1);

  const res = await room.fetch(new Request("https://room/count"));
  assert.deepEqual(await res.json(), { n: 1 });
});

test("a restored snapshot shows in /count-adjacent standings and a fresh hello's welcome", async () => {
  const now = Date.now();
  const round = roundAt(now);
  const ctx = new FakeCtx();
  ctx.map.set("standings", { round, rows: [{ id: "d".repeat(64), name: "Ghost", tag: "dddd", time: 12.34, at: now }] });
  const room = new Room(ctx, { DB: fakeD1() });
  await ctx.ready;

  const res = await room.fetch(new Request("https://room/count"));
  assert.deepEqual(await res.json(), { n: 0 });   // restored standings carry no live socket

  const ws = new FakeSocket(); room.accept(ws);
  await hello(room, ws, SECRET_C, "Carol");
  const welcome = ws.json(0);
  assert.equal(welcome.t, "welcome");
  assert.ok(welcome.standings.some(s => s.name === "Ghost" && s.time === 12.34));
});

test("alarm sends results to helloed sockets and re-arms only while players remain", async () => {
  const { room, ctx } = await makeRoom();
  const a = new FakeSocket(); room.accept(a);
  await hello(room, a, SECRET_A, "Alpha");
  a.sent = [];

  await room.alarm();
  assert.ok(a.types().includes("results"));
  assert.ok(ctx.alarmAt !== null);

  ctx.alarmAt = null;
  await room.webSocketClose(a, 1000, "bye");
  await room.alarm();
  assert.equal(ctx.alarmAt, null);
});

test("webSocketClose completes the handshake and notifies others with leave", async () => {
  const { room } = await makeRoom();
  const a = new FakeSocket(); room.accept(a);
  await hello(room, a, SECRET_A, "Alpha");
  const b = new FakeSocket(); room.accept(b);
  await hello(room, b, SECRET_B, "Bravo");
  b.sent = [];

  await room.webSocketClose(a, 1000, "bye");
  assert.equal(a.closedWith.code, 1000);
  assert.ok(b.types().includes("leave"));
});

test("webSocketClose translates the non-sendable 1005 to 1000", async () => {
  const { room } = await makeRoom();
  const ws = new FakeSocket(); room.accept(ws);
  await room.webSocketClose(ws, 1005, "");
  assert.equal(ws.closedWith.code, 1000);
});
