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
CREATE INDEX IF NOT EXISTS runs_track_time ON runs (track_id, time);
CREATE TABLE IF NOT EXISTS pair_codes (
  code TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  expires INTEGER NOT NULL
);
