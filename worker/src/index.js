// Neon Drift leaderboard API. Seven routes, JSON in and out, CORS to the game's
// origin, per-IP rate limits on writes. Times are never trusted: /runs
// replays the submitted inputs through the game's physics and stores what
// that produces. Pairing never hands a secret to whoever types a code: the
// new device shows the code and collects with a private token; the device
// that already has the secret is the one that types (see /pair/*).

import { replay, trackFor } from "./replay.js";
import * as v from "./validate.js";
import * as db from "./db.js";

const TOP_N = 10;
const PAIR_TTL_MS = 5 * 60 * 1000;   // long enough to walk to the other device; short enough to bound polling

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const bad = (error, status = 400) => json({ error }, status);

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => v.CODE_ALPHABET[b % v.CODE_ALPHABET.length]).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Only origins listed in ALLOWED_ORIGINS get CORS headers. Production lists the
// GitHub Pages site; `wrangler dev --env dev` swaps in localhost and, via
// ALLOW_LAN, any private-network origin so a phone on the same wifi can test
// against the local worker (see wrangler.toml). Production never sets ALLOW_LAN.
const LAN_ORIGIN = /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^./:]+\.local)(:\d+)?$/;
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || (env.ALLOW_LAN === "1" && LAN_ORIGIN.test(origin));
  return ok ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  } : {};
}

async function limited(binding, request) {
  if (!binding) return false;                                   // no binding in local dev
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const { success } = await binding.limit({ key: ip });
  return !success;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// ---------- routes ----------

async function postRun(body, env) {
  if (!body || !v.validSecret(body.secret) || !v.validSeed(body.seed) || !v.validTrackId(body.trackId)
      || !v.validInputs(body.inputs) || !v.validGhost(body.ghost) || !v.validTime(body.time)) return bad("invalid-run");
  const name = v.cleanName(body.name);
  if (!name) return bad("invalid-name");
  if (trackFor(body.seed).id !== body.trackId) return bad("track-mismatch");

  const r = replay(body.seed, body.inputs, { ghost: body.ghost, claimedTime: body.time });
  if (!r.ok) return json({ accepted: false, reason: r.reason, time: r.time }, 200);

  const playerId = await sha256Hex(body.secret);
  const now = Date.now();
  await db.upsertPlayer(env.DB, playerId, name, now);
  const best = await db.bestFor(env.DB, body.trackId, playerId);
  const improved = best == null || r.time < best;
  if (improved) await db.upsertRun(env.DB, { trackId: body.trackId, playerId, time: r.time, inputs: body.inputs, ghost: body.ghost, now });
  const rank = await db.rankOf(env.DB, body.trackId, improved ? r.time : best);
  return json({ accepted: true, improved, time: r.time, rank, rankCap: db.RANK_CAP });
}

async function getBoard(url, env) {
  const trackId = url.searchParams.get("track");
  const player = url.searchParams.get("player");
  if (!v.validTrackId(trackId)) return bad("invalid-track");
  const rows = await db.topRuns(env.DB, trackId, TOP_N);
  // `id` is the sha256 player id — public by design (it is what /ghost is keyed on), never the secret.
  const top = rows.map(r => ({ id: r.id, name: r.name, tag: r.id.slice(0, 4), time: r.time, at: r.at }));
  let me = null;
  if (player && /^[0-9a-f]{64}$/.test(player)) {
    const inTop = rows.findIndex(r => r.id === player);
    if (inTop >= 0) {
      me = { rank: inTop + 1, time: rows[inTop].time, name: rows[inTop].name, tag: player.slice(0, 4) };
    } else {
      const row = await db.myRow(env.DB, trackId, player);          // one PK lookup
      if (row) me = { rank: await db.rankOf(env.DB, trackId, row.time), time: row.time, name: row.name, tag: player.slice(0, 4) };
    }
  }
  return json({ top, me, rankCap: db.RANK_CAP });
}

async function getGhost(url, env) {
  const trackId = url.searchParams.get("track");
  const player = url.searchParams.get("player");
  if (!v.validTrackId(trackId) || !player || !/^[0-9a-f]{64}$/.test(player)) return bad("invalid-ghost");
  const row = await db.ghostFor(env.DB, trackId, player);
  if (!row) return bad("not-found", 404);
  let ghost;
  try { ghost = JSON.parse(row.ghost); } catch { return bad("corrupt-ghost", 500); }
  return json({ id: player, name: row.name, tag: player.slice(0, 4), time: row.time, ghost });
}

async function postName(body, env) {
  if (!body || !v.validSecret(body.secret)) return bad("invalid-secret");
  const name = v.cleanName(body.name);
  if (!name) return bad("invalid-name");
  const id = await sha256Hex(body.secret);
  await db.upsertPlayer(env.DB, id, name, Date.now());
  return json({ ok: true, tag: id.slice(0, 4) });
}

// ---------- pairing (device-authorization shape, as in RFC 8628) ----------

/** The new device: mints a code to show and a token to keep. Needs no secret — that is the point. */
async function pairStart(env) {
  const now = Date.now(), expires = now + PAIR_TTL_MS;
  await db.purgePairings(env.DB, now);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(), token = randomToken();
    try { await db.createPairing(env.DB, code, token, expires); return json({ code, token, expires }); }
    catch { /* code collision: try another */ }
  }
  return bad("try-again", 503);
}

/** The device that has the secret: types the code it sees on the new device. */
async function pairApprove(body, env) {
  if (!body || !v.validCode(body.code)) return bad("invalid-code");
  if (!v.validSecret(body.secret)) return bad("invalid-secret");
  const ok = await db.approvePairing(env.DB, body.code, body.secret, Date.now());
  return ok ? json({ ok: true }) : bad("unknown-code", 404);
}

/** The new device, on a timer: pending until approved, then the secret exactly once. */
async function pairPoll(body, env) {
  if (!body || !v.validToken(body.token)) return bad("invalid-token");
  const r = await db.collectPairing(env.DB, body.token, Date.now());
  if (!r) return bad("unknown-token", 404);
  if (r.status === "pending") return json({ status: "pending" });
  const name = await db.playerName(env.DB, await sha256Hex(r.secret));
  return json({ status: "ready", secret: r.secret, name });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const withCors = async (make) => {
      const res = await make();
      for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
      return res;
    };
    try {
      if (request.method === "GET" && url.pathname === "/board") return withCors(() => getBoard(url, env));
      if (request.method === "GET" && url.pathname === "/ghost") return withCors(() => getGhost(url, env));
      if (request.method === "POST") {
        // Polling is one indexed read every couple of seconds; it has its own
        // budget so it never competes with, or exhausts, the write limit.
        if (url.pathname === "/pair/poll") {
          if (await limited(env.POLL_LIMIT, request)) return withCors(() => bad("rate-limited", 429));
          return withCors(async () => pairPoll(await readJson(request), env));
        }
        // Approving is the only surface where a code is guessed at; it gets the tight limit on top.
        if (url.pathname === "/pair/approve" && await limited(env.CLAIM_LIMIT, request)) return withCors(() => bad("rate-limited", 429));
        if (await limited(env.POST_LIMIT, request)) return withCors(() => bad("rate-limited", 429));
        const body = await readJson(request);
        if (url.pathname === "/runs") return withCors(() => postRun(body, env));
        if (url.pathname === "/name") return withCors(() => postName(body, env));
        if (url.pathname === "/pair/start") return withCors(() => pairStart(env));
        if (url.pathname === "/pair/approve") return withCors(() => pairApprove(body, env));
      }
      return withCors(() => bad("not-found", 404));
    } catch (err) {
      console.error(err);
      return withCors(() => bad("server-error", 500));
    }
  },
};
