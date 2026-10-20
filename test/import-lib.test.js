import { describe, expect, it } from 'vitest';
import { collectTvTimeShows, matchEpisodes, mergeByTvmaze, seedSql } from '../scripts/import-lib.js';

const userSeries = (s_id, fields) => ({ s_id, series_name: '', is_followed: 'true', is_archived: 'false', created_at: '2021-01-01 00:00:00', ...fields });
const followed = (tv_show_id, fields) => ({ tv_show_id, tv_show_name: '', active: '1', archived: '0', created_at: '2021-01-01 00:00:00', ...fields });
const watch = (s_id, season, number, fields) => ({
  s_id, series_name: '', season_number: String(season), episode_number: String(number), is_special: '', created_at: '2022-01-01 00:00:00', ...fields,
});

describe('collectTvTimeShows', () => {
  const collect = (input) => collectTvTimeShows({ userSeries: [], followed: [], watches: [], ...input });

  it('stops a show archived in the followed table', () => {
    const shows = collect({ followed: [followed('1', { archived: '1' })] });
    expect(shows.get('1').stopped).toBe(true);
  });

  it('stops an unfollowed user series', () => {
    const shows = collect({ userSeries: [userSeries('1', { is_followed: 'false' })] });
    expect(shows.get('1').stopped).toBe(true);
  });

  it('lets the user-series row win over the followed table', () => {
    const shows = collect({
      userSeries: [userSeries('1', { is_archived: 'false', is_followed: 'true' })],
      followed: [followed('1', { archived: '1' })],
    });
    expect(shows.get('1').stopped).toBe(false);
    expect(shows.get('1').hasUserSeries).toBe(true);
  });

  it('stops a show that only appears in watches', () => {
    const shows = collect({ watches: [watch('1', 1, 1)] });
    expect(shows.get('1').stopped).toBe(true);
    expect(shows.get('1').name).toBeNull();
  });

  it('trims the name', () => {
    const shows = collect({ followed: [followed('1', { tv_show_name: 'Harry Potter ' })] });
    expect(shows.get('1').name).toBe('Harry Potter');
  });

  it('excludes specials from watches', () => {
    const shows = collect({ watches: [watch('1', 1, 1), watch('1', 0, 1, { is_special: 'true' })] });
    expect(shows.get('1').watches).toEqual([{ season: 1, number: 1, watchedAt: '2022-01-01 00:00:00' }]);
  });

  it('takes addedAt from the earliest row', () => {
    const shows = collect({
      userSeries: [userSeries('1', { created_at: '2021-05-01 10:00:00' })],
      followed: [followed('1', { created_at: '2020-03-02 10:00:00' })],
      watches: [watch('1', 1, 1, { created_at: '2020-03-01 09:00:00' })],
    });
    expect(shows.get('1').addedAt).toBe('2020-03-01 09:00:00');
  });
});

describe('mergeByTvmaze', () => {
  it('merges records that resolve to the same TVmaze show', () => {
    const merged = mergeByTvmaze([
      {
        tvmazeId: 7,
        tvTime: {
          tvdbId: '75340', name: 'Prison Break', stopped: false, addedAt: '2019-02-10 22:26:36', hasUserSeries: false,
          watches: [{ season: 1, number: 1, watchedAt: '2019-03-01 00:00:00' }],
        },
      },
      {
        tvmazeId: 7,
        tvTime: {
          tvdbId: '360115', name: 'Prison Break', stopped: true, addedAt: '2020-01-01 00:00:00', hasUserSeries: true,
          watches: [
            { season: 1, number: 1, watchedAt: '2020-02-01 00:00:00' },
            { season: 1, number: 2, watchedAt: '2020-02-02 00:00:00' },
          ],
        },
      },
    ]);
    expect(merged).toEqual([{
      tvmazeId: 7,
      stopped: true,
      addedAt: '2019-02-10 22:26:36',
      watches: [
        { season: 1, number: 1, watchedAt: '2019-03-01 00:00:00' },
        { season: 1, number: 2, watchedAt: '2020-02-02 00:00:00' },
      ],
    }]);
  });
});

describe('matchEpisodes', () => {
  it('matches on season and number and reports the rest', () => {
    const episodes = [{ id: 42, show_id: 7, season: 1, number: 1, name: 'Pilot', airdate: '2005-08-29', runtime: 60 }];
    const watches = [
      { season: 1, number: 1, watchedAt: '2019-03-01 00:00:00' },
      { season: 9, number: 9, watchedAt: '2019-03-02 00:00:00' },
    ];
    expect(matchEpisodes(watches, episodes)).toEqual({
      matched: [{ episodeId: 42, watchedAt: '2019-03-01 00:00:00' }],
      unmatched: [{ season: 9, number: 9 }],
    });
  });
});

describe('seedSql', () => {
  const sql = seedSql([{
    show: { id: 1, name: "Inside Bill's Brain", status: 'Ended', image_url: null, premiered_year: 2019, tvmaze_updated: 100 },
    episodes: [{ id: 2, show_id: 1, season: 1, number: 1, name: 'Part One', airdate: null, runtime: 60 }],
    stopped: true,
    addedAt: '2020-01-01 00:00:00',
    watched: [{ episodeId: 2, watchedAt: '2020-01-02 00:00:00' }],
  }]);

  it('starts by clearing every table', () => {
    expect(sql.startsWith('DELETE FROM watched;\nDELETE FROM episodes;\nDELETE FROM shows;\n')).toBe(true);
  });

  it('escapes quotes and writes nulls as NULL', () => {
    expect(sql).toContain("'Inside Bill''s Brain'");
    expect(sql).toContain("(2, 1, 1, 1, 'Part One', NULL, 60)");
  });

  it('inserts one row per show, episode and watched episode', () => {
    expect(sql.match(/^INSERT INTO shows /gm)).toHaveLength(1);
    expect(sql.match(/^INSERT INTO episodes /gm)).toHaveLength(1);
    expect(sql).toContain("INSERT INTO watched (episode_id, watched_at) VALUES (2, '2020-01-02 00:00:00');");
  });

  it('has no transaction statements', () => {
    expect(sql).not.toMatch(/BEGIN|COMMIT/);
  });
});
