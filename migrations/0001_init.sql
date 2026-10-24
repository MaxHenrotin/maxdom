-- Shows, episodes and books are shared; following, ticks and reads belong to an account.
CREATE TABLE shows (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  image_url TEXT,
  premiered_year INTEGER,
  tvmaze_updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id),
  season INTEGER NOT NULL,
  number INTEGER NOT NULL,
  name TEXT,
  airstamp TEXT,
  runtime INTEGER
);

CREATE INDEX episodes_show_id ON episodes(show_id);

-- summary is kept once read from monde-aquilon.com: NULL until then, '' when the site has none.
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  series TEXT NOT NULL,
  volume INTEGER NOT NULL,
  title TEXT,
  published TEXT NOT NULL,
  cover_url TEXT,
  summary TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE user_shows (
  user_id INTEGER NOT NULL REFERENCES users(id),
  show_id INTEGER NOT NULL REFERENCES shows(id),
  stopped INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, show_id)
);

CREATE TABLE watched (
  user_id INTEGER NOT NULL REFERENCES users(id),
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  watched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE books_read (
  user_id INTEGER NOT NULL REFERENCES users(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
