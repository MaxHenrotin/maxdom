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

describe('GET /api/shows', () => {
  it('sums the runtime of the watched and of the aired episodes of each show', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name, added_at) VALUES (7, 'Show', 'x'), (8, 'Empty', 'x')").run();
    await db.prepare(`INSERT INTO episodes (id, show_id, season, number, airdate, runtime) VALUES
      (1, 7, 1, 1, '2020-01-01', 50), (2, 7, 1, 2, '2020-01-08', 45), (3, 7, 1, 3, '2020-01-15', NULL)`).run();
    await db.prepare("INSERT INTO watched VALUES (1, 'x'), (3, 'x')").run();

    const shows = await (await worker.fetch(new Request('http://localhost/api/shows'), { DB: db })).json();

    expect(shows.map((show) => [show.id, show.minutes, show.aired_minutes])).toEqual([[7, 50, 95], [8, 0, 0]]);
  });
});
