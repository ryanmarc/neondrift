// The Room Durable Object shell (worker/src/live.js) against a fake Durable
// Object ctx: no cloudflare:workers import in live.js means node --test can
// drive webSocketMessage / webSocketClose / alarm directly, the same calls
// the real Hibernation API would make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1.mjs";

const { Room, HELLO_MS, IP_PER_ROOM } = await import("../worker/src/live.js");
const { roundAt, roundStart, RACING_MS, GRACE_MS, SLOT_MS } = await import(new URL("../js/live/clock.js", import.meta.url));

/** Run `fn` with Date.now() pinned to `ms` (the shell reads the clock itself, as the runtime's alarm() gives it no time). */
async function at(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = real; }
}
const R = roundAt(Date.now());
const RACING = roundStart(R) + 30000;                           // 30s into this round's racing
const RESULTS = roundStart(R) + RACING_MS + GRACE_MS + 1000;    // just after the round's alarm time

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
  assert.equal(old.closedWith.code, 4003, "a hello timeout is a retryable drop, not an abuse verdict");
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
  const a = new FakeSocket(); room.accept(a, RESULTS - 5000);
  await at(RESULTS - 5000, () => hello(room, a, SECRET_A, "Alpha"));
  a.sent = [];

  ctx.alarmAt = null;                     // so the assertion below sees alarm() re-arm, not the hello's arm
  await at(RESULTS, () => room.alarm());
  assert.ok(a.types().includes("results"));
  assert.ok(ctx.alarmAt !== null);

  ctx.alarmAt = null;
  await room.webSocketClose(a, 1000, "bye");
  await at(RESULTS, () => room.alarm());
  assert.equal(ctx.alarmAt, null);
});

test("an alarm that fires late, inside the next round's racing, sends no results but still re-arms", async () => {
  const { room, ctx } = await makeRoom();
  const a = new FakeSocket(); room.accept(a, RACING);
  await at(RACING, () => hello(room, a, SECRET_A, "Alpha"));
  a.sent = [];
  ctx.alarmAt = null;
  await at(RACING + 1000, () => room.alarm());
  assert.ok(!a.types().includes("results"));
  assert.ok(ctx.alarmAt !== null);
});

test("alarm closes a player idle for over a round with 4002 and keeps an active one", async () => {
  const { room, ctx } = await makeRoom();
  const t0 = RESULTS - SLOT_MS - 5000;
  const idle = new FakeSocket(); room.accept(idle, t0);
  await at(t0, () => hello(room, idle, SECRET_A, "Alpha"));
  const busy = new FakeSocket(); room.accept(busy, t0);
  await at(t0, () => hello(room, busy, SECRET_B, "Bravo"));
  await at(RESULTS - 20000, () => room.webSocketMessage(busy, JSON.stringify({ t: "pose", p: [1, 2, 3, 0.5] })));
  busy.sent = [];

  await at(RESULTS, () => room.alarm());
  assert.equal(idle.closedWith?.code, 4002);
  assert.equal(busy.readyState, 1);
  assert.equal(room.room.players.size, 1);
  assert.ok(busy.types().includes("leave"), "the others hear the idle player leave");
  assert.ok(ctx.alarmAt !== null);
});

test("a pose sent while the hello's D1 lookup is pending is dropped, and the hello still completes", async () => {
  const DB = stallableDB();
  const { room } = await makeRoom({ DB });
  const ws = new FakeSocket(); room.accept(ws);
  const resolvePlayerName = DB.stall();
  const pending = hello(room, ws, SECRET_A, "Alpha");
  await room.webSocketMessage(ws, JSON.stringify({ t: "pose", p: [0, 0, 0, 0] }));     // the car is already driving
  await room.webSocketMessage(ws, JSON.stringify({ t: "hello", secret: SECRET_A }));  // a second hello mid-hello: dropped too
  assert.equal(ws.closedWith, null);
  resolvePlayerName(null);
  await pending;
  assert.equal(ws.closedWith, null);
  assert.equal(room.room.players.size, 1);
  assert.equal(ws.json(0).t, "welcome");
  assert.equal(ws.sent.length, 1);
});

test("a hello that never completes is still swept with 4003", async () => {
  const DB = stallableDB();
  const { room } = await makeRoom({ DB });
  const base = Date.now();
  const ws = new FakeSocket(); room.accept(ws, base);
  DB.stall();
  hello(room, ws, SECRET_A, "Alpha");   // never resolves
  await new Promise(r => setTimeout(r, 0));
  room.sweep(base + HELLO_MS + 1);
  assert.equal(ws.closedWith?.code, 4003);
});

test("one IP holds at most IP_PER_ROOM sockets in a room; the next upgrade is refused 429", async () => {
  const { room } = await makeRoom();
  const ip = "203.0.113.9";
  for (let i = 0; i < IP_PER_ROOM; i++) {
    const ws = new FakeSocket(); room.accept(ws, Date.now(), ip);
    if (i === 0) await hello(room, ws, SECRET_A, "Alpha");   // a helloed socket still counts against its IP
  }
  const res = await room.fetch(new Request("https://room/live/room/room-1", { headers: { upgrade: "websocket", "cf-connecting-ip": ip } }));
  assert.equal(res.status, 429);
  assert.equal(room.ipCount(ip), IP_PER_ROOM);
  assert.equal(room.ipCount("198.51.100.1"), 0);
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
