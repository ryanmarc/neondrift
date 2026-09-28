// The live mode's Durable Object: one Room per name, holding its players'
// WebSockets through the Hibernation API. Every rule is in room-core.js; this
// is only the shell that feeds messages in, sends what comes out, persists
// the standings and keeps one alarm for each round's results. A plain class
// (no cloudflare:workers import) so node --test can import the worker.

import * as core from "./room-core.js";
import { replay } from "./replay.js";
import { validSecret } from "./validate.js";
import { playerName } from "./db.js";
import { sha256Hex } from "./hash.js";
import { roundAt, roundStart, RACING_MS, GRACE_MS } from "../../js/live/clock.js";

export const MAX_FRAME = 16 * 1024;
export const ROOM_NAME = /^room-([1-9]\d?)$/;   // room-1 … room-99
export const HELLO_MS = 10000;   // a socket that never says hello is swept after this long
const MAX_ROOMS = 50;
const OPEN = 1;   // WebSocket.readyState: OPEN. Both browsers and workerd use the standard 0/1/2/3 states.

const verify = (seed, inputs, time) => replay(seed, inputs, { claimedTime: time, laps: 1 });

/** GET /live/join: the first room with space, asked in order. */
export async function joinRoom(env) {
  for (let k = 1; k <= MAX_ROOMS; k++) {
    const name = "room-" + k;
    const res = await env.ROOM.get(env.ROOM.idFromName(name)).fetch("https://room/count");
    const { n } = await res.json();
    if (n < core.ROOM_CAP) return name;
  }
  return null;
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.room = core.createRoom();
    // Hibernation keeps the sockets but not this object: rebuild the standings
    // from storage and the players from each socket's attachment.
    ctx.blockConcurrencyWhile(async () => {
      core.restore(this.room, await ctx.storage.get("standings"));
      const now = Date.now();
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a && a.id) core.join(this.room, a.id, a.name, now);
      }
    });
  }

  /** Accept a socket and stamp it with when it arrived, so an unhelloed one can be swept. */
  accept(ws, now = Date.now()) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ at: now });
  }

  /** Close any socket that has been open more than HELLO_MS without saying hello. */
  sweep(now) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && !a.id && now - a.at > HELLO_MS) {
        try { ws.close(1008, "hello timeout"); } catch { /* already closing */ }
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.sweep(now);
    // Open sockets, not joined players: an unhelloed socket still holds a slot
    // (and would otherwise let /live/join keep sending traffic to a saturated room).
    if (url.pathname === "/count") return Response.json({ n: this.ctx.getWebSockets().length });
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.ctx.getWebSockets().length >= core.ROOM_CAP + 4) return new Response("full", { status: 503 });
    const pair = new WebSocketPair();
    this.accept(pair[1], now);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(out, from) {
    const sockets = this.ctx.getWebSockets();
    for (const { to, msg } of out) {
      const text = JSON.stringify(msg);
      for (const s of sockets) {
        const a = s.deserializeAttachment();
        if (!a || !a.id) continue;
        if (to === "all" || (to === "others" && a.id !== from) || to === a.id) {
          try { s.send(text); } catch { /* closing: its close handler cleans up */ }
        }
      }
    }
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_FRAME) return ws.close(1008, "frame");
    let msg;
    try { msg = JSON.parse(data); } catch { return ws.close(1008, "json"); }
    const now = Date.now();
    const a = ws.deserializeAttachment();

    if (!a || !a.id) {
      if (!msg || msg.t !== "hello" || !validSecret(msg.secret)) return ws.close(1008, "hello first");
      const id = await sha256Hex(msg.secret);
      let stored;
      try { stored = await playerName(this.env.DB, id); }
      catch { return ws.close(1011, "lookup failed"); }
      // The socket may have closed (or been swept) while those awaits were in
      // flight; joining it now would add a phantom player that never leaves.
      if (ws.readyState !== OPEN) return;
      const name = core.nameFor(stored, msg.name);
      const r = core.join(this.room, id, name, now);
      if (!r.ok) return ws.close(4001, "full");
      // The same player on another socket (a second tab): that one goes. Its
      // attachment is cleared first so its close doesn't remove this player.
      for (const other of this.ctx.getWebSockets()) {
        const oa = other.deserializeAttachment();
        if (other !== ws && oa && oa.id === id) { other.serializeAttachment({ replaced: true }); other.close(4000, "replaced"); }
      }
      ws.serializeAttachment({ id, name });
      this.send(r.out, id);
      await this.ensureAlarm(now);
      return;
    }

    const r = core.handle(this.room, a.id, msg, now, verify);
    this.send(r.out, a.id);
    if (r.dirty) await this.ctx.storage.put("standings", core.snapshot(this.room));
    if (r.close) ws.close(1008, "abuse");
  }

  async webSocketClose(ws, code, reason) {
    // Completes the closing handshake on the client's initiated close; 1005 is
    // a reserved "no status" code the client may report but can't be re-sent.
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch { /* already closed */ }
    this.gone(ws);
  }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = ws.deserializeAttachment();
    if (a && a.id) this.send(core.leave(this.room, a.id), a.id);
  }

  /** One alarm, at the current (or next) round's racing end + grace. */
  async ensureAlarm(now) {
    const r = roundAt(now);
    let at = roundStart(r) + RACING_MS + GRACE_MS;
    if (at <= now) at = roundStart(r + 1) + RACING_MS + GRACE_MS;
    if ((await this.ctx.storage.getAlarm()) !== at) await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    const now = Date.now();
    this.sweep(now);
    core.rollRound(this.room, now);
    this.send([{ to: "all", msg: core.resultsMsg(this.room) }]);
    if (this.room.players.size) await this.ensureAlarm(now);   // an empty room lets its alarm lapse and hibernates
  }
}
