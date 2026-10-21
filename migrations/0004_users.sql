-- Shows, episodes and books stay shared; following, ticks and reads belong to an account.
-- Everything already in the database becomes the owner's.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
INSERT INTO users (id, email, created_at) VALUES (1, 'max.henrotin@gmail.com', strftime('%Y-%m-%dT%H:%M:%fZ'));

CREATE TABLE user_shows (
  user_id INTEGER NOT NULL REFERENCES users(id),
  show_id INTEGER NOT NULL REFERENCES shows(id),
  stopped INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, show_id)
);
INSERT INTO user_shows SELECT 1, id, stopped, added_at FROM shows;
ALTER TABLE shows DROP COLUMN stopped;
ALTER TABLE shows DROP COLUMN added_at;

-- SQLite can't change a primary key in place, hence the rebuilds.
CREATE TABLE watched_by_user (
  user_id INTEGER NOT NULL REFERENCES users(id),
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  watched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, episode_id)
);
INSERT INTO watched_by_user SELECT 1, episode_id, watched_at FROM watched;
DROP TABLE watched;
ALTER TABLE watched_by_user RENAME TO watched;

CREATE TABLE books_read_by_user (
  user_id INTEGER NOT NULL REFERENCES users(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
INSERT INTO books_read_by_user SELECT 1, book_id, read_at FROM books_read;
DROP TABLE books_read;
ALTER TABLE books_read_by_user RENAME TO books_read;
