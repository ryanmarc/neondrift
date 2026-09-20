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
CREATE TABLE IF NOT EXISTS pair_codes (
  code TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pair_codes_expires ON pair_codes (expires);
