// The live routes in the worker's fetch handler: /live/join picks a room with
// space, and /live/room/<name> refuses what it must before any socket exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1.mjs";

const worker = (await import("../worker/src/index.js")).default;

/** A ROOM namespace whose rooms report the given counts, and record forwarded requests. */
function rooms(counts) {
  const forwarded = [], asked = [];
  let inFlight = 0;
  const r = {
    forwarded, asked, maxInFlight: 0,
    idFromName: name => name,
    get: name => ({
      fetch: async (req) => {
        const url = new URL(typeof req === "string" ? req : req.url);
        if (url.pathname === "/count") {
          asked.push(name);
          inFlight++; r.maxInFlight = Math.max(r.maxInFlight, inFlight);
          await new Promise(res => setTimeout(res, 1));
          inFlight--;
          return Response.json({ n: counts[name] ?? 0 });
        }
        forwarded.push(name);
        return new Response("upgraded", { status: 200 });
      },
    }),
  };
  return r;
}
const env = (counts, extra = {}) => ({ DB: fakeD1(), ALLOWED_ORIGINS: "https://game.test", ROOM: rooms(counts), ...extra });
const get = (e, path, headers = {}) => worker.fetch(new Request("https://api.test" + path, { headers }), e);

test("join returns the first room with space", async () => {
  assert.deepEqual(await (await get(env({}), "/live/join")).json(), { room: "room-1" });
  assert.deepEqual(await (await get(env({ "room-1": 16 }), "/live/join")).json(), { room: "room-2" });
  assert.deepEqual(await (await get(env({ "room-1": 16, "room-2": 3 }), "/live/join")).json(), { room: "room-2" });
});

test("join asks all 10 rooms at once and picks the lowest-numbered with space", async () => {
  const full = Object.fromEntries(Array.from({ length: 10 }, (_, k) => ["room-" + (k + 1), 16]));
  const e = env({ ...full, "room-3": 5, "room-7": 0 });
  assert.deepEqual(await (await get(e, "/live/join")).json(), { room: "room-3" });
  assert.equal(e.ROOM.asked.length, 10);
  assert.equal(e.ROOM.maxInFlight, 10, "the counts are asked in parallel, not one after another");
  const all = env(full);
  assert.equal((await get(all, "/live/join")).status, 503);
  assert.ok(!all.ROOM.asked.includes("room-11"), "no more than 10 rooms");
});

test("join returns the preferred room while it has space, else the normal pick", async () => {
  assert.deepEqual(await (await get(env({}), "/live/join?prefer=room-5")).json(), { room: "room-5" });
  assert.deepEqual(await (await get(env({ "room-5": 16 }), "/live/join?prefer=room-5")).json(), { room: "room-1" });
  assert.deepEqual(await (await get(env({}), "/live/join?prefer=lobby")).json(), { room: "room-1" });
});

test("join is rate limited per IP", async () => {
  const e = env({}, { JOIN_LIMIT: { limit: async () => ({ success: false }) } });
  assert.equal((await get(e, "/live/join")).status, 429);
});

test("join carries CORS for the game's origin", async () => {
  const res = await get(env({}), "/live/join", { origin: "https://game.test" });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://game.test");
});

test("the room socket refuses a foreign origin, a bad name and a plain GET", async () => {
  const e = env({});
  const ws = { upgrade: "websocket" };
  assert.equal((await get(e, "/live/room/room-1", { ...ws, origin: "https://evil.test" })).status, 403);
  assert.equal((await get(e, "/live/room/lobby", { ...ws, origin: "https://game.test" })).status, 400);
  assert.equal((await get(e, "/live/room/room-1", { origin: "https://game.test" })).status, 426);
  assert.deepEqual(e.ROOM.forwarded, []);
});

test("a good upgrade is forwarded to the named room", async () => {
  const e = env({});
  await get(e, "/live/room/room-3", { upgrade: "websocket", origin: "https://game.test" });
  assert.deepEqual(e.ROOM.forwarded, ["room-3"]);
});

test("the room socket is rate limited per IP", async () => {
  const e = env({}, { JOIN_LIMIT: { limit: async () => ({ success: false }) } });
  const res = await get(e, "/live/room/room-1", { upgrade: "websocket", origin: "https://game.test" });
  assert.equal(res.status, 429);
  assert.deepEqual(e.ROOM.forwarded, []);
});
