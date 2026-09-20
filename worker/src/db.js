// The handful of D1 statements the API needs. Each takes the D1 binding.
// D1's free tier bills rows read, and an index entry counts as a row, so every
// statement here is either a primary-key lookup or an index walk that stops
// early. Check with EXPLAIN QUERY PLAN before changing one.

export async function upsertPlayer(db, id, name, now) {
  await db.prepare(
    "INSERT INTO players (id, name, created) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name = ?2"
  ).bind(id, name, now).run();
}

export async function playerName(db, id) {
  const row = await db.prepare("SELECT name FROM players WHERE id = ?1").bind(id).first();
  return row ? row.name : null;
}

export async function bestFor(db, trackId, playerId) {
  const row = await db.prepare("SELECT time FROM runs WHERE track_id = ?1 AND player_id = ?2").bind(trackId, playerId).first();
  return row ? row.time : null;
}

/** The player's row on a track with their name, in one lookup; null if none. */
export async function myRow(db, trackId, playerId) {
  return db.prepare(
    "SELECT r.time AS time, p.name AS name FROM runs r JOIN players p ON p.id = r.player_id WHERE r.track_id = ?1 AND r.player_id = ?2"
  ).bind(trackId, playerId).first();
}

/** Insert or replace the player's row for the track. Caller has already checked it is faster. */
export async function upsertRun(db, { trackId, playerId, time, inputs, ghost, now }) {
  await db.prepare(
    "INSERT INTO runs (track_id, player_id, time, inputs, ghost, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
    "ON CONFLICT(track_id, player_id) DO UPDATE SET time = ?3, inputs = ?4, ghost = ?5, created = ?6"
  ).bind(trackId, playerId, time, JSON.stringify(inputs), JSON.stringify(ghost), now).run();
}

export const RANK_CAP = 100;

/**
 * 1-based rank a time would have on the track, exact up to RANK_CAP. Beyond
 * that it returns RANK_CAP + 1, meaning "worse than 100th": counting is a walk
 * over every faster row, so the LIMIT bounds what a deep rank can cost.
 */
export async function rankOf(db, trackId, time) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM (SELECT 1 FROM runs WHERE track_id = ?1 AND time < ?2 LIMIT ?3)"
  ).bind(trackId, time, RANK_CAP).first();
  return row.n + 1;
}

export async function topRuns(db, trackId, n) {
  const { results } = await db.prepare(
    "SELECT r.player_id AS id, p.name AS name, r.time AS time, r.created AS at " +
    "FROM runs r JOIN players p ON p.id = r.player_id WHERE r.track_id = ?1 ORDER BY r.time ASC, r.created ASC LIMIT ?2"
  ).bind(trackId, n).all();
  return results;
}

/** Drop expired codes. Range scan on the expires index: only dead rows are touched. */
export async function purgeCodes(db, now) {
  await db.prepare("DELETE FROM pair_codes WHERE expires < ?1").bind(now).run();
}

export async function createCode(db, code, secret, expires) {
  await db.prepare("INSERT INTO pair_codes (code, secret, expires) VALUES (?1, ?2, ?3)").bind(code, secret, expires).run();
}

/** Consume a code: returns the secret if it exists and hasn't expired, deleting it either way. */
export async function takeCode(db, code, now) {
  const row = await db.prepare("SELECT secret, expires FROM pair_codes WHERE code = ?1").bind(code).first();
  if (!row) return null;
  await db.prepare("DELETE FROM pair_codes WHERE code = ?1").bind(code).run();
  return row.expires > now ? row.secret : null;
}
