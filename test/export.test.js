import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { createD1 } from './d1.js';

describe('GET /api/export', () => {
  it('downloads a SQL dump that rebuilds the same database', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name) VALUES (7, 'Inside Bill''s Brain')").run();
    await db.prepare("INSERT INTO episodes (id, show_id, season, number, airstamp, runtime) VALUES (1, 7, 1, 1, '2019-09-20T07:00:00.000Z', NULL)").run();
    await db.prepare("INSERT INTO watched VALUES (1, 1, '2021-03-04 20:00:00')").run();
    await db.prepare("INSERT INTO books (id, series, volume, title, published) VALUES ('elfes-t01', 'Elfes', 1, 'Le Crystal', '2013-02-27')").run();
    await db.prepare("INSERT INTO books_read VALUES (1, 'elfes-t01', '2026-10-20T18:33:09.219Z')").run();

    const res = await worker.fetch(new Request('http://localhost/api/export'), { DB: db, DEV_EMAIL: 'max.henrotin@gmail.com' });

    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="sauvegarde-\d{4}-\d{2}-\d{2}\.sql"$/);
    const restored = new DatabaseSync(':memory:');
    restored.exec(await res.text());
    for (const table of ['shows', 'episodes', 'watched', 'books', 'books_read']) {
      const rows = (await db.prepare(`SELECT * FROM ${table}`).all()).results;
      expect(restored.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
    }
    expect(restored.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()).toEqual([{ name: 'episodes_show_id' }]);
  });
});
