CREATE TABLE books (
  id TEXT PRIMARY KEY,
  series TEXT NOT NULL,
  volume INTEGER NOT NULL,
  title TEXT,
  published TEXT NOT NULL,
  cover_url TEXT
);

CREATE TABLE books_read (
  book_id TEXT PRIMARY KEY REFERENCES books(id),
  read_at TEXT NOT NULL
);
