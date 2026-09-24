CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  track_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  time REAL NOT NULL,
  inputs TEXT NOT NULL,
  ghost TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (track_id, player_id)
);
-- (track_id, time, created) lets the top-N query walk the index in order and
-- stop at the LIMIT; without `created` the tie-break forced a sort over every
-- row of the track, and D1 bills every row touched.
CREATE INDEX IF NOT EXISTS runs_track_time_created ON runs (track_id, time, created);
DROP INDEX IF EXISTS runs_track_time;
-- Device pairing. The new device shows `code` and keeps `token`; the device
-- that has the secret types the code, which fills `secret`; the new device
-- collects it by token, which deletes the row. Rows are minutes-lived.
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  secret TEXT,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pairings_expires ON pairings (expires);
-- The earlier one-way flow (code returned the secret to whoever typed it).
DROP TABLE IF EXISTS pair_codes;
