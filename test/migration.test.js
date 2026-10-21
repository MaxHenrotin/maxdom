import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('0004_users', () => {
  it('gives the existing list to the owner account', () => {
    const db = new DatabaseSync(':memory:');
    const [users, ...earlier] = readdirSync('migrations').sort().reverse();
    for (const file of earlier.reverse()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    db.exec(`
      INSERT INTO shows (id, name, stopped, added_at) VALUES (7, 'Show', 1, 'x');
      INSERT INTO episodes (id, show_id, season, number) VALUES (1, 7, 1, 1), (2, 7, 1, 2);
      INSERT INTO watched VALUES (1, 'w');
      INSERT INTO books (id, series, volume, published) VALUES ('elfes-t01', 'Elfes', 1, '2013-02-27');
      INSERT INTO books_read VALUES ('elfes-t01', 'r');`);

    expect(users).toBe('0004_users.sql');
    db.exec(readFileSync(`migrations/${users}`, 'utf8'));

    expect(db.prepare('SELECT id, email FROM users').all()).toEqual([{ id: 1, email: 'max.henrotin@gmail.com' }]);
    expect(db.prepare('SELECT * FROM user_shows').all()).toEqual([{ user_id: 1, show_id: 7, stopped: 1, added_at: 'x' }]);
    expect(db.prepare('SELECT * FROM watched').all()).toEqual([{ user_id: 1, episode_id: 1, watched_at: 'w' }]);
    expect(db.prepare('SELECT * FROM books_read').all()).toEqual([{ user_id: 1, book_id: 'elfes-t01', read_at: 'r' }]);
    expect(db.prepare('SELECT name FROM pragma_table_info(?)').all('shows').map((c) => c.name)).not.toContain('stopped');
    expect(db.prepare('SELECT name FROM pragma_table_info(?)').all('shows').map((c) => c.name)).not.toContain('added_at');
  });
});
