import { afterEach, describe, expect, it, vi } from 'vitest';
import { toEpisodeRows, toShowRow, tvmazeGet } from '../src/tvmaze.js';

const show = {
  id: 54198,
  name: 'Severance',
  status: 'Running',
  premiered: '2022-06-23',
  image: { medium: 'm.jpg' },
  updated: 1782836072,
  _embedded: {
    episodes: [
      { id: 1, season: 1, number: 1, name: 'Good News About Hell', airdate: '2022-02-18', runtime: 57 },
      { id: 2, season: 1, number: null, name: 'Special', airdate: '2022-03-01', runtime: 20 },
      { id: 3, season: 2, number: 1, name: 'Hello, Ms. Cobel', airdate: '', runtime: null },
    ],
  },
};

describe('toShowRow', () => {
  it('maps the TVmaze show to a row', () => {
    expect(toShowRow(show)).toEqual({
      id: 54198,
      name: 'Severance',
      status: 'Running',
      image_url: 'm.jpg',
      premiered_year: 2022,
      tvmaze_updated: 1782836072,
    });
  });

  it('gives null image_url and premiered_year when TVmaze has none', () => {
    const row = toShowRow({ ...show, image: null, premiered: null });
    expect(row.image_url).toBeNull();
    expect(row.premiered_year).toBeNull();
  });
});

describe('toEpisodeRows', () => {
  it('drops specials and turns an empty airdate into null', () => {
    expect(toEpisodeRows(show)).toEqual([
      { id: 1, show_id: 54198, season: 1, number: 1, name: 'Good News About Hell', airdate: '2022-02-18', runtime: 57 },
      { id: 3, show_id: 54198, season: 2, number: 1, name: 'Hello, Ms. Cobel', airdate: null, runtime: null },
    ]);
  });
});

describe('tvmazeGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (...statuses) => {
    const fetch = vi.fn();
    for (const status of statuses) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status }));
    }
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('resolves to null on 404', async () => {
    respond(404);
    expect(await tvmazeGet('/shows/0')).toBeNull();
  });

  it('retries after a 429', async () => {
    const fetch = respond(429, 200);
    expect(await tvmazeGet('/shows/1', 0)).toEqual({ id: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('https://api.tvmaze.com/shows/1');
  });

  it('rejects on a server error', async () => {
    respond(500);
    await expect(tvmazeGet('/shows/1')).rejects.toThrow('500');
  });
});
