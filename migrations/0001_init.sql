CREATE TABLE shows (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  image_url TEXT,
  premiered_year INTEGER,
  stopped INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  tvmaze_updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id),
  season INTEGER NOT NULL,
  number INTEGER NOT NULL,
  name TEXT,
  airdate TEXT,
  runtime INTEGER
);

CREATE INDEX episodes_show_id ON episodes(show_id);

CREATE TABLE watched (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(id),
  watched_at TEXT NOT NULL
);
