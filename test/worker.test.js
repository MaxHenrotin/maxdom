import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker.js';
import { createD1 } from './d1.js';

// User 1, created by createD1, owns the rows the tests insert.
const OWNER = 'owner@example.com';
const call = (db, path, { email = OWNER, ...init } = {}) => worker.fetch(new Request(`http://localhost/api${path}`, init), { DB: db, DEV_EMAIL: email });
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

describe('GET /api/shows/:id', () => {
  it('gives the category and the date each episode was watched', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name, status) VALUES (7, 'Show', 'Ended')").run();
    await db.prepare("INSERT INTO user_shows VALUES (1, 7, 1, 'x')").run();
    await db.prepare("INSERT INTO episodes (id, show_id, season, number, airstamp) VALUES (1, 7, 1, 1, '2020-01-01'), (2, 7, 1, 2, '2020-01-08')").run();
    await db.prepare("INSERT INTO watched VALUES (1, 1, '2021-03-04 20:00:00')").run();

    const show = await (await call(db, '/shows/7')).json();

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
    await db.prepare("INSERT INTO shows (id, name) VALUES (7, 'Show'), (8, 'Empty')").run();
    await db.prepare("INSERT INTO user_shows VALUES (1, 7, 0, 'x'), (1, 8, 0, 'x')").run();
    await db.prepare(`INSERT INTO episodes (id, show_id, season, number, airstamp, runtime) VALUES
      (1, 7, 1, 1, '2020-01-01', 50), (2, 7, 1, 2, '2020-01-08', 45), (3, 7, 1, 3, '2020-01-15', NULL)`).run();
    await db.prepare("INSERT INTO watched VALUES (1, 1, 'x'), (1, 3, 'x')").run();

    const shows = await (await call(db, '/shows')).json();

    expect(shows.map((show) => [show.id, show.minutes, show.aired_minutes])).toEqual([[7, 50, 95], [8, 0, 0]]);
  });

  it('gives the air time of the next episode, or null when none is announced', async () => {
    const db = createD1();
    await db.prepare("INSERT INTO shows (id, name) VALUES (7, 'Show'), (8, 'Empty')").run();
    await db.prepare("INSERT INTO user_shows VALUES (1, 7, 0, 'x'), (1, 8, 0, 'x')").run();
    await db.prepare(`INSERT INTO episodes (id, show_id, season, number, airstamp) VALUES
      (1, 7, 1, 1, '2020-01-01T01:00:00.000Z'), (2, 7, 2, 2, '2999-01-08T01:00:00.000Z'), (3, 7, 2, 1, '2999-01-01T01:00:00.000Z')`).run();

    const shows = await (await call(db, '/shows')).json();

    expect(shows.map((show) => [show.id, show.next_airstamp])).toEqual([[7, '2999-01-01T01:00:00.000Z'], [8, null]]);
  });
});

describe('accounts', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The owner follows show 7 (episode 1 ticked) and show 8; "a" follows show 7 only.
  async function twoAccounts() {
    const db = createD1();
    await db.prepare("INSERT INTO users (id, email, created_at) VALUES (2, 'a@example.com', 'x')").run();
    await db.prepare("INSERT INTO shows (id, name) VALUES (7, 'Shared'), (8, 'Owner only')").run();
    await db.prepare("INSERT INTO episodes (id, show_id, season, number, airstamp) VALUES (1, 7, 1, 1, '2020-01-01'), (2, 7, 1, 2, '2020-01-08'), (3, 8, 1, 1, '2020-01-01')").run();
    await db.prepare("INSERT INTO user_shows VALUES (1, 7, 0, 'x'), (1, 8, 0, 'x'), (2, 7, 0, 'x')").run();
    await db.prepare("INSERT INTO watched VALUES (1, 1, 'x')").run();
    return db;
  }
  const count = async (db, sql) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).first()).n;

  it('answers 401 without an identity', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/shows'), { DB: createD1() });
    expect(res.status).toBe(401);
  });

  it('gives the email of the account', async () => {
    expect(await (await call(createD1(), '/me', { email: 'a@example.com' })).json()).toEqual({ email: 'a@example.com' });
  });

  it('creates the account on the first request', async () => {
    const db = createD1();
    expect(await (await call(db, '/shows', { email: 'new@example.com' })).json()).toEqual([]);
    expect((await db.prepare('SELECT id, email FROM users ORDER BY id').all()).results).toEqual([
      { id: 1, email: OWNER },
      { id: 2, email: 'new@example.com' },
    ]);
  });

  it('keeps two accounts apart', async () => {
    const db = await twoAccounts();
    const a = { email: 'a@example.com' };

    expect((await (await call(db, '/shows', a)).json()).map((show) => [show.id, show.seen])).toEqual([[7, 0]]);
    expect((await call(db, '/shows/8', a)).status).toBe(404);
    expect((await call(db, '/shows/8', { ...a, method: 'PATCH', body: JSON.stringify({ stopped: true }) })).status).toBe(404);
    await call(db, '/shows/8', { ...a, method: 'DELETE' });

    expect(await db.prepare('SELECT stopped FROM user_shows WHERE user_id = 1 AND show_id = 8').first()).toEqual({ stopped: 0 });
    expect(await count(db, 'episodes WHERE show_id = 8')).toBe(1);
  });

  it('follows a show already in the catalogue without calling TVmaze', async () => {
    const db = await twoAccounts();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const res = await call(db, '/shows', { email: 'a@example.com', ...json({ tvmazeId: 8 }) });

    expect(res.status).toBe(201);
    expect((await res.json()).seen).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 409 when the account already follows the show', async () => {
    const db = await twoAccounts();
    expect((await call(db, '/shows', { email: 'a@example.com', ...json({ tvmazeId: 7 }) })).status).toBe(409);
  });

  it('ignores ticks on a show the account does not follow', async () => {
    const db = await twoAccounts();
    await call(db, '/watched', { email: 'a@example.com', ...json({ episodeIds: [2, 3], watched: true }) });
    expect((await db.prepare('SELECT user_id, episode_id FROM watched ORDER BY user_id, episode_id').all()).results).toEqual([
      { user_id: 1, episode_id: 1 },
      { user_id: 2, episode_id: 2 },
    ]);
  });

  it('only unticks the episodes of the account', async () => {
    const db = await twoAccounts();
    await call(db, '/watched', { email: 'a@example.com', ...json({ episodeIds: [1], watched: false }) });
    expect(await count(db, 'watched WHERE user_id = 1')).toBe(1);
  });

  it('keeps the show for the other followers on unfollow, deletes it after the last one', async () => {
    const db = await twoAccounts();
    await call(db, '/watched', { email: 'a@example.com', ...json({ episodeIds: [2], watched: true }) });

    await call(db, '/shows/7', { email: 'a@example.com', method: 'DELETE' });
    expect(await count(db, 'episodes WHERE show_id = 7')).toBe(2);
    expect((await db.prepare('SELECT user_id, episode_id FROM watched').all()).results).toEqual([{ user_id: 1, episode_id: 1 }]);

    await call(db, '/shows/7', { method: 'DELETE' });
    expect(await count(db, 'shows WHERE id = 7')).toBe(0);
    expect(await count(db, 'episodes WHERE show_id = 7')).toBe(0);
    expect(await count(db, 'watched')).toBe(0);
  });
});
