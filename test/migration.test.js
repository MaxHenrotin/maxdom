import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('0004_users', () => {
  it('gives the existing list to the owner account', () => {
    const db = new DatabaseSync(':memory:');
    for (const file of readdirSync('migrations').sort().filter((file) => file < '0004')) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    db.exec(`
      INSERT INTO shows (id, name, stopped, added_at) VALUES (7, 'Show', 1, 'x');
      INSERT INTO episodes (id, show_id, season, number) VALUES (1, 7, 1, 1), (2, 7, 1, 2);
      INSERT INTO watched VALUES (1, 'w');
      INSERT INTO books (id, series, volume, published) VALUES ('elfes-t01', 'Elfes', 1, '2013-02-27');
      INSERT INTO books_read VALUES ('elfes-t01', 'r');`);

    db.exec(readFileSync('migrations/0004_users.sql', 'utf8'));

    expect(db.prepare('SELECT id, email FROM users').all()).toEqual([{ id: 1, email: 'max.henrotin@gmail.com' }]);
    expect(db.prepare('SELECT * FROM user_shows').all()).toEqual([{ user_id: 1, show_id: 7, stopped: 1, added_at: 'x' }]);
    expect(db.prepare('SELECT * FROM watched').all()).toEqual([{ user_id: 1, episode_id: 1, watched_at: 'w' }]);
    expect(db.prepare('SELECT * FROM books_read').all()).toEqual([{ user_id: 1, book_id: 'elfes-t01', read_at: 'r' }]);
    expect(db.prepare("SELECT name FROM pragma_table_info('shows')").all().map((c) => c.name)).toEqual([
      'id', 'name', 'status', 'image_url', 'premiered_year', 'tvmaze_updated',
    ]);
  });
});

describe('0005_unstop_unwatched', () => {
  it('clears the stopped flag of shows with nothing watched', () => {
    const db = new DatabaseSync(':memory:');
    for (const file of readdirSync('migrations').sort().filter((file) => file < '0005')) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    db.exec(`
      INSERT INTO users (id, email, created_at) VALUES (2, 'a@example.com', 'x');
      INSERT INTO shows (id, name) VALUES (7, 'Started'), (8, 'Never started');
      INSERT INTO episodes (id, show_id, season, number) VALUES (1, 7, 1, 1), (2, 8, 1, 1);
      INSERT INTO user_shows VALUES (1, 7, 1, 'x'), (1, 8, 1, 'x'), (2, 7, 1, 'x');
      INSERT INTO watched VALUES (1, 1, 'w');`);

    db.exec(readFileSync('migrations/0005_unstop_unwatched.sql', 'utf8'));

    expect(db.prepare('SELECT user_id, show_id, stopped FROM user_shows ORDER BY user_id, show_id').all()).toEqual([
      { user_id: 1, show_id: 7, stopped: 1 },
      { user_id: 1, show_id: 8, stopped: 0 },
      { user_id: 2, show_id: 7, stopped: 0 },
    ]);
  });
});
