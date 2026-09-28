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
const MAX_ROOMS = 50;

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

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/count") return Response.json({ n: this.room.players.size });
    if (request.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    // sockets that never say hello are bounded too
    if (this.ctx.getWebSockets().length >= core.ROOM_CAP + 4) return new Response("full", { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
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
      const name = core.nameFor(await playerName(this.env.DB, id), msg.name);
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

  async webSocketClose(ws) { this.gone(ws); }
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
    core.rollRound(this.room, now);
    this.send([{ to: "all", msg: core.resultsMsg(this.room) }]);
    if (this.room.players.size) await this.ensureAlarm(now);   // an empty room lets its alarm lapse and hibernates
  }
}
