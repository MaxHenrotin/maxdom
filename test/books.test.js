import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERIES } from '../src/aquilon.js';
import { refreshBooks } from '../src/books.js';
import worker from '../src/worker.js';
import { createD1 } from './d1.js';

const fixture = (name) => readFileSync(`test/fixtures/aquilon/${name}`, 'utf8');

// Serves the first listing page of the given series and an empty listing everywhere else.
// From the series named in failFrom on, every request gets a 500.
function stubSite(firstPages, { failFrom } = {}) {
  const failAt = SERIES.findIndex((series) => series.slug === failFrom);
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const [, slug, page] = new URL(url).pathname.match(/^\/catalogue\/([^/]+)\/(?:page\/(\d+)\/)?$/);
    if (failAt >= 0 && SERIES.findIndex((series) => series.slug === slug) >= failAt) return new Response('', { status: 500 });
    return new Response(page ? '' : firstPages[slug] ?? '');
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('refreshBooks', () => {
  it('saves the deduplicated catalogue and keeps what was read', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO books (id, series, volume, title, published) VALUES ('elfes-t36', 'Elfes', 36, 'Old title', '2026-09-24')").run();
    await db.prepare("INSERT INTO books_read VALUES (1, 'elfes-t36', '2026-10-01T10:00:00.000Z')").run();
    stubSite({ elfes: fixture('elfes-page-1.html') });

    await refreshBooks({ DB: db });

    const ids = (await db.prepare('SELECT id FROM books').all()).results.map((r) => r.id);
    expect(ids).toContain('elfes-t37');
    expect(ids).not.toContain('elfes-t37-edition-nb');
    expect((await db.prepare("SELECT title FROM books WHERE id = 'elfes-t36'").first()).title).not.toBe('Old title');
    expect(await db.prepare("SELECT 1 FROM books_read WHERE book_id = 'elfes-t36'").first()).not.toBeNull();
  });

  it('saves what it fetched before the site failed and deletes nothing', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO books (id, series, volume, published) VALUES ('mages-t01', 'Mages', 1, '2019-01-01')").run();
    stubSite({ elfes: fixture('elfes-page-1.html') }, { failFrom: 'nains' });

    await refreshBooks({ DB: db });

    const ids = (await db.prepare('SELECT id FROM books').all()).results.map((r) => r.id);
    expect(ids).toContain('elfes-t37');
    expect(ids).toContain('mages-t01');
  });
});

describe('scheduled', () => {
  it('runs the TVmaze refresh on the daily cron and the books refresh on the weekly one', async () => {
    const hosts = async (cron) => {
      const fetch = vi.fn(async () => Response.json({}));
      vi.stubGlobal('fetch', fetch);
      let job;
      worker.scheduled({ cron }, { DB: createD1() }, { waitUntil: (promise) => { job = promise; } });
      await job;
      return new Set(fetch.mock.calls.map(([url]) => new URL(url).host));
    };
    expect([...await hosts('0 5 * * *')]).toEqual(['api.tvmaze.com']);
    expect([...await hosts('0 6 * * 1')]).toEqual(['www.monde-aquilon.com']);
  });
});

describe('books API', () => {
  let db;
  const call = (path, init, email = 'max.henrotin@gmail.com') => worker.fetch(new Request(`http://localhost${path}`, init), { DB: db, DEV_EMAIL: email });
  const get = async (path) => (await call(path)).json();
  const post = (path, body, email) => call(path, { method: 'POST', body: JSON.stringify(body) }, email);
  const readIds = async () => (await db.prepare('SELECT book_id FROM books_read ORDER BY book_id').all()).results.map((r) => r.book_id);

  beforeEach(async () => {
    db = createD1();
    await db.prepare(`INSERT INTO books (id, series, volume, title, published) VALUES
      ('n1', 'Nains', 1, 'N', '2020-01-01'), ('e9', 'Elfes', 9, 'E', '2020-01-01'),
      ('m1', 'Mages', 1, 'M', '2999-01-01'), ('mages-t04', 'Mages', 4, 'Arundill', '2020-08-26')`).run();
    await db.prepare("INSERT INTO books_read VALUES (1, 'e9', '2026-10-01T10:00:00.000Z')").run();
  });

  it('lists the volumes in global order with their read state', async () => {
    const books = await get('/api/books');
    expect(books.map((b) => [b.id, b.released, b.read_at !== null])).toEqual([
      ['e9', true, true], ['n1', true, false], ['mages-t04', true, false], ['m1', false, false],
    ]);
  });

  it('shows one circle per volume even when two editions were stored', async () => {
    await db.prepare("INSERT INTO books (id, series, volume, published) VALUES ('nains-t01-edition-nb', 'Nains', 1, '2019-12-01')").run();
    const books = await get('/api/books');
    expect(books.filter((b) => b.series === 'Nains' && b.volume === 1).map((b) => b.id)).toEqual(['n1']);
  });

  it('ticks and unticks, but never a volume that is not out yet', async () => {
    await post('/api/books/read', { bookIds: ['n1', 'm1'], read: true });
    expect(await readIds()).toEqual(['e9', 'n1']);
    await post('/api/books/read', { bookIds: ['e9'], read: false });
    expect(await readIds()).toEqual(['n1']);
    expect((await post('/api/books/read', { bookIds: 'n1', read: true })).status).toBe(400);
  });

  it('keeps read ticks per account', async () => {
    await post('/api/books/read', { bookIds: ['n1'], read: true }, 'a@example.com');
    await post('/api/books/read', { bookIds: ['e9'], read: false }, 'a@example.com');
    const read = async (email) => (await (await call('/api/books', undefined, email)).json()).filter((b) => b.read_at).map((b) => b.id);
    expect(await read('a@example.com')).toEqual(['n1']);
    expect(await read('max.henrotin@gmail.com')).toEqual(['e9']);
  });

  it('returns the summary of a known volume', async () => {
    const fetch = vi.fn(async () => new Response(fixture('mages-t04.html')));
    vi.stubGlobal('fetch', fetch);
    expect((await get('/api/books/mages-t04/summary')).summary).toMatch(/^Arundill a six ans/);
    expect(fetch).toHaveBeenCalledWith('https://www.monde-aquilon.com/livre/mages-t04/');
  });

  it('refuses a summary for an unknown id without fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const id of ['foo', '..%2F..%2Fwp-admin']) {
      expect((await call(`/api/books/${id}/summary`)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
