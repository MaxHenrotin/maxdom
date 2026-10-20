import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { createD1 } from './d1.js';

describe('GET /api/shows/:id', () => {
  it('gives the category and the date each episode was watched', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name, status, stopped, added_at) VALUES (7, 'Show', 'Ended', 1, 'x')").run();
    await db.prepare("INSERT INTO episodes (id, show_id, season, number, airdate) VALUES (1, 7, 1, 1, '2020-01-01'), (2, 7, 1, 2, '2020-01-08')").run();
    await db.prepare("INSERT INTO watched VALUES (1, '2021-03-04 20:00:00')").run();

    const res = await worker.fetch(new Request('http://localhost/api/shows/7'), { DB: db });
    const show = await res.json();

    expect(show.category).toBe('stopped');
    expect(show.episodes.map((ep) => [ep.id, ep.watched, ep.watched_at])).toEqual([
      [1, true, '2021-03-04 20:00:00'],
      [2, false, null],
    ]);
  });
});
