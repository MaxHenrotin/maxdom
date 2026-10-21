import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickShowsToRefresh, refresh } from '../src/refresh.js';
import { createD1 } from './d1.js';

describe('pickShowsToRefresh', () => {
  const myShows = [{ id: 1, tvmaze_updated: 100 }, { id: 2, tvmaze_updated: 50 }, { id: 3, tvmaze_updated: 10 }];
  const updates = { 1: 100, 2: 60, 3: 20, 99: 500 };

  it('picks my shows updated since the last fetch, oldest first', () => {
    expect(pickShowsToRefresh(myShows, updates)).toEqual([3, 2]);
  });

  it('stops at the limit', () => {
    expect(pickShowsToRefresh(myShows, updates, 1)).toEqual([3]);
  });

  // Each show can take 4 fetches (3 retries on 429); with the updates call and two D1 calls
  // the run has to stay within the 50 subrequests of the free plan.
  it('caps a run so that retries still fit in the subrequest budget', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, tvmaze_updated: 0 }));
    const changed = Object.fromEntries(many.map((show) => [show.id, 1]));
    expect(pickShowsToRefresh(many, changed).length * 4 + 3).toBeLessThanOrEqual(50);
  });
});

describe('refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves the shows fetched before a TVmaze error', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name, tvmaze_updated) VALUES (1, 'A', 0), (2, 'B', 5)").run();
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/updates/shows?since=week')) return json({ 1: 100, 2: 100 });
      if (url.includes('/shows/1?')) return json({ id: 1, name: 'A', status: 'Running', image: null, premiered: null, updated: 100, _embedded: { episodes: [] } });
      return json({}, 500);
    }));

    expect(await refresh({ DB: db })).toEqual({ refreshed: 1 });
    expect((await db.prepare('SELECT tvmaze_updated FROM shows WHERE id = 1').first()).tvmaze_updated).toBe(100);
  });
});
