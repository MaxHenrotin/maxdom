import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { createD1, migratedDatabase } from './d1.js';

// The owner (user 1) follows show 7 and read elfes-t01; a@example.com (user 2) follows show 8 and read nains-t01.
async function twoAccounts() {
  const db = createD1();
  await db.prepare("INSERT INTO users (id, email, created_at) VALUES (2, 'a@example.com', '2026-10-21T10:00:00.000Z')").run();
  await db.prepare("INSERT INTO shows (id, name) VALUES (7, 'Owner Show'), (8, 'Inside Bill''s Brain')").run();
  await db.prepare(`INSERT INTO episodes (id, show_id, season, number, airstamp, runtime) VALUES
    (1, 7, 1, 1, '2019-01-01T07:00:00.000Z', 30), (3, 8, 1, 1, '2019-09-20T07:00:00.000Z', NULL)`).run();
  await db.prepare("INSERT INTO user_shows VALUES (1, 7, 0, 'x'), (2, 8, 1, '2026-10-21T10:01:00.000Z')").run();
  await db.prepare("INSERT INTO watched VALUES (1, 1, 'w1'), (2, 3, '2026-10-21T10:02:00.000Z')").run();
  await db.prepare("INSERT INTO books (id, series, volume, title, published) VALUES ('elfes-t01', 'Elfes', 1, 'Le Crystal', '2013-02-27'), ('nains-t01', 'Nains', 1, 'Redwin', '2013-04-03')").run();
  await db.prepare("INSERT INTO books_read VALUES (1, 'elfes-t01', 'r1'), (2, 'nains-t01', '2026-10-21T10:03:00.000Z')").run();
  return db;
}

const exportAs = (db, email) => worker.fetch(new Request('http://localhost/api/export'), { DB: db, DEV_EMAIL: email });

describe('GET /api/export', () => {
  it("leaves out the other accounts' rows", async () => {
    const sql = await (await exportAs(await twoAccounts(), 'a@example.com')).text();

    expect(sql).not.toMatch(/Owner Show|owner@|w1|r1/);
    expect(sql).toContain("Inside Bill''s Brain");
  });

  it('names the file after the part of the email before the @, in safe characters', async () => {
    const res = await exportAs(createD1(), 'jane.doe+"tv"@example.com');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="maxdom_jane\.doe--tv-_\d{4}-\d{2}-\d{2}\.sql"$/);
  });

  it('restores into another database without touching its accounts', async () => {
    const res = await exportAs(await twoAccounts(), 'a@example.com');
    const target = migratedDatabase();
    target.exec(`
      INSERT INTO users (id, email, created_at) VALUES (2, 'b@example.com', 'x');
      INSERT INTO shows (id, name) VALUES (8, 'Kept name');
      INSERT INTO user_shows VALUES (2, 8, 0, 'b');`);

    target.exec(await res.text());

    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="maxdom_a_\d{4}-\d{2}-\d{2}\.sql"$/);
    const a = target.prepare("SELECT id, created_at FROM users WHERE email = 'a@example.com'").get();
    expect(a).toEqual({ id: 3, created_at: '2026-10-21T10:00:00.000Z' });
    expect(target.prepare('SELECT * FROM user_shows ORDER BY user_id').all()).toEqual([
      { user_id: 2, show_id: 8, stopped: 0, added_at: 'b' },
      { user_id: 3, show_id: 8, stopped: 1, added_at: '2026-10-21T10:01:00.000Z' },
    ]);
    expect(target.prepare('SELECT * FROM watched').all()).toEqual([{ user_id: 3, episode_id: 3, watched_at: '2026-10-21T10:02:00.000Z' }]);
    expect(target.prepare('SELECT * FROM books_read').all()).toEqual([{ user_id: 3, book_id: 'nains-t01', read_at: '2026-10-21T10:03:00.000Z' }]);
    expect(target.prepare('SELECT name FROM shows').all()).toEqual([{ name: 'Kept name' }]);
    expect(target.prepare('SELECT id FROM books ORDER BY id').all()).toEqual([{ id: 'elfes-t01' }, { id: 'nains-t01' }]);
  });
});
