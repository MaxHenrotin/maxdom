import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    await db.prepare("INSERT INTO books_read VALUES ('elfes-t36', '2026-10-01T10:00:00.000Z')").run();
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
