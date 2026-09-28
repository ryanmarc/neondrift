// The live room connection: ask the worker for a room, open a WebSocket to
// it, say hello, and keep it open. Reports status through onStatus; hands
// every parsed message to onMessage.
//
// Never having connected, a failed join is "unavailable" and final, so the
// title screen isn't left retrying. Once connected, a drop retries with
// backoff (1, 2, 4… capped at 15s) — reset back to the base only once a
// message actually arrives (the welcome), not merely on opening a socket, so
// a room that accepts the socket and then rejects every hello (or drops it
// right away) backs off instead of hammering the per-IP join rate limit at
// ~1/s forever. Close code 4000 means the same player opened live somewhere
// else: stop, or the two tabs would displace each other forever. 4002 is the
// room evicting a player unseen for a whole round: final, status "idle". 1008
// is a deliberate protocol verdict from the room (bad hello, a bad frame,
// abuse) and is just as final. 4001 (full: lost the race for the last seat)
// and 4003 (the hello didn't finish in time) are ordinary drops — they retry
// through the same backoff, not at once.
//
// send() refuses (returns false) until the room has answered this socket's
// hello: anything sent before the welcome would reach a room that doesn't yet
// know who is talking. A reconnect asks for the room it was last welcomed in.

import { API_URL } from "../config/params.js";

export const wsUrl = (api, room) => api.replace(/^http/, "ws") + "/live/room/" + encodeURIComponent(room);

export function connect(hello, { onMessage, onStatus }, { baseMs = 1000 } = {}) {
  let ws = null, closed = false, ever = false, backoff = baseMs, timer = 0;
  let heard = false;       // has the current socket received anything (the welcome)?
  let lastRoom = null;     // the room the last welcome came from, asked for again on reconnect

  async function open() {
    onStatus(ever ? "offline" : "joining");
    let room = null;
    try {
      const res = await fetch(API_URL + "/live/join" + (lastRoom ? "?prefer=" + encodeURIComponent(lastRoom) : ""));
      if (res.ok) room = (await res.json()).room;
    } catch { /* unreachable */ }
    if (closed) return;
    if (!room) {
      if (!ever) { closed = true; onStatus("unavailable"); return; }
      return retry();
    }
    const sock = ws = new WebSocket(wsUrl(API_URL, room));
    heard = false;
    sock.onopen = () => { ever = true; sock.send(JSON.stringify(hello())); };
    sock.onmessage = e => {
      if (ws !== sock) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      // Reset backoff once, the first time this socket actually says something.
      if (!heard) { heard = true; backoff = baseMs; lastRoom = room; }
      onMessage(m);
    };
    sock.onclose = e => {
      if (ws === sock) ws = null;
      if (closed) return;
      if (e.code === 4000) { closed = true; onStatus("displaced"); return; }
      if (e.code === 4002) { closed = true; onStatus("idle"); return; }
      if (e.code === 1008) { closed = true; onStatus("unavailable"); return; }
      if (!ever) { closed = true; onStatus("unavailable"); return; }
      onStatus("offline");
      retry();
    };
  }

  function retry() {
    clearTimeout(timer);
    timer = setTimeout(open, backoff);
    backoff = Math.min(15000, backoff * 2);
  }

  open();
  return {
    send(msg) {
      if (!ws || ws.readyState !== 1 || !heard) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close() { closed = true; clearTimeout(timer); if (ws) ws.close(1000); ws = null; },
  };
}
