import { identify } from './auth.js';
import { BOOKS_CRON, getSummary, listBooks, refreshBooks, setRead } from './books.js';
import { categorize } from './categories.js';
import { upsertShowStatements } from './db.js';
import { exportDatabase } from './export.js';
import { error } from './http.js';
import { refresh } from './refresh.js';
import { toEpisodeRows, toShowRow, tvmazeGet } from './tvmaze.js';

// The shows account ?2 follows. SUM over a LEFT JOIN is NULL for a show without episodes, hence the COALESCE.
const SUMMARY_SQL = `
  SELECT s.id, s.name, s.status, s.image_url, s.premiered_year, us.stopped,
    COALESCE(SUM(w.episode_id IS NOT NULL), 0) AS seen,
    COALESCE(SUM(CASE WHEN w.episode_id IS NOT NULL THEN e.runtime END), 0) AS minutes,
    COALESCE(SUM(CASE WHEN e.airstamp <= ?1 THEN e.runtime END), 0) AS aired_minutes,
    COALESCE(SUM(e.airstamp <= ?1), 0) AS aired,
    COALESCE(SUM(e.airstamp <= ?1 AND w.episode_id IS NULL), 0) AS airedUnseen,
    MIN(CASE WHEN e.airstamp > ?1 THEN e.airstamp END) AS next_airstamp
  FROM user_shows us
  JOIN shows s ON s.id = us.show_id
  LEFT JOIN episodes e ON e.show_id = s.id
  LEFT JOIN watched w ON w.episode_id = e.id AND w.user_id = us.user_id
  WHERE us.user_id = ?2`;

function toSummary({ airedUnseen, ...row }) {
  const stopped = Boolean(row.stopped);
  return { ...row, stopped, category: categorize({ stopped, status: row.status, seen: row.seen, airedUnseen }) };
}

async function listShows(db, now, user) {
  const { results } = await db.prepare(`${SUMMARY_SQL} GROUP BY s.id`).bind(now, user.id).all();
  return Response.json(results.map(toSummary));
}

const showSummary = (db, now, user, id) =>
  db.prepare(`${SUMMARY_SQL} AND s.id = ?3 GROUP BY s.id`).bind(now, user.id, id).first();

async function getShow(db, now, user, id) {
  const show = await showSummary(db, now, user, id);
  if (!show) return error(404, 'unknown show');
  const { results } = await db
    .prepare(`
      SELECT e.id, e.season, e.number, e.name, e.airstamp, w.watched_at
      FROM episodes e LEFT JOIN watched w ON w.episode_id = e.id AND w.user_id = ?2
      WHERE e.show_id = ?1
      ORDER BY e.season, e.number`)
    .bind(id, user.id)
    .all();
  return Response.json({
    ...toSummary(show),
    now,
    episodes: results.map((ep) => ({ ...ep, watched: ep.watched_at !== null })),
  });
}

// A show someone else already follows is in the catalogue, so TVmaze isn't asked again.
async function addShow(db, now, user, { tvmazeId }) {
  if (!Number.isInteger(tvmazeId)) return error(400, 'tvmazeId must be an integer');
  if (await db.prepare('SELECT 1 FROM user_shows WHERE user_id = ?1 AND show_id = ?2').bind(user.id, tvmazeId).first()) {
    return error(409, 'already in the list');
  }
  const follow = db.prepare('INSERT INTO user_shows (user_id, show_id, added_at) VALUES (?1, ?2, ?3)').bind(user.id, tvmazeId, now);
  if (await db.prepare('SELECT 1 FROM shows WHERE id = ?1').bind(tvmazeId).first()) {
    await follow.run();
  } else {
    const json = await tvmazeGet(`/shows/${tvmazeId}?embed=episodes`);
    if (!json) return error(404, 'unknown show');
    await db.batch([...upsertShowStatements(db, toShowRow(json), toEpisodeRows(json)), follow]);
  }
  return Response.json(toSummary(await showSummary(db, now, user, tvmazeId)), { status: 201 });
}

async function setStopped(db, user, id, { stopped }) {
  if (typeof stopped !== 'boolean') return error(400, 'stopped must be a boolean');
  const { meta } = await db
    .prepare('UPDATE user_shows SET stopped = ?1 WHERE user_id = ?2 AND show_id = ?3')
    .bind(stopped ? 1 : 0, user.id, id)
    .run();
  if (meta.changes === 0) return error(404, 'unknown show');
  return Response.json({ ok: true });
}

// The show leaves the catalogue with its last follower, so the refresh cron only sees followed shows.
async function removeShow(db, user, id) {
  const unfollowed = 'NOT EXISTS (SELECT 1 FROM user_shows WHERE show_id = ?1)';
  await db.batch([
    db.prepare('DELETE FROM watched WHERE user_id = ?2 AND episode_id IN (SELECT id FROM episodes WHERE show_id = ?1)').bind(id, user.id),
    db.prepare('DELETE FROM user_shows WHERE user_id = ?2 AND show_id = ?1').bind(id, user.id),
    db.prepare(`DELETE FROM episodes WHERE show_id = ?1 AND ${unfollowed}`).bind(id),
    db.prepare(`DELETE FROM shows WHERE id = ?1 AND ${unfollowed}`).bind(id),
  ]);
  return Response.json({ ok: true });
}

// Only aired episodes of followed shows can be ticked, whatever the client sends.
async function setWatched(db, now, user, { episodeIds, watched }) {
  if (!Array.isArray(episodeIds) || !episodeIds.every(Number.isInteger) || typeof watched !== 'boolean') {
    return error(400, 'expected { episodeIds: number[], watched: boolean }');
  }
  const ids = JSON.stringify(episodeIds);
  if (watched) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO watched (user_id, episode_id, watched_at)
        SELECT ?3, id, ?2 FROM episodes
        WHERE id IN (SELECT value FROM json_each(?1)) AND airstamp IS NOT NULL AND airstamp <= ?2
          AND show_id IN (SELECT show_id FROM user_shows WHERE user_id = ?3)`)
      .bind(ids, now, user.id)
      .run();
  } else {
    await db.prepare('DELETE FROM watched WHERE user_id = ?2 AND episode_id IN (SELECT value FROM json_each(?1))').bind(ids, user.id).run();
  }
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname.replace(/\/\d+$/, '/:id')}`;
    const id = Number(pathname.split('/').pop());
    const now = new Date().toISOString();
    const body = () => request.json().then((json) => json ?? {}, () => ({}));
    const db = env.DB;

    const email = await identify(request, env);
    if (!email) return error(401, 'not logged in');
    // The first request from an email creates its account.
    const user = await db
      .prepare('INSERT INTO users (email, created_at) VALUES (?1, ?2) ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING id, email')
      .bind(email, now)
      .first();

    // Book ids are slugs, which the numeric :id pattern above doesn't cover.
    const summary = pathname.match(/^\/api\/books\/([a-z0-9-]+)\/summary$/);
    if (request.method === 'GET' && summary) return getSummary(db, summary[1]);

    switch (route) {
      case 'GET /api/shows': return listShows(db, now, user);
      case 'GET /api/shows/:id': return getShow(db, now, user, id);
      case 'POST /api/shows': return addShow(db, now, user, await body());
      case 'PATCH /api/shows/:id': return setStopped(db, user, id, await body());
      case 'DELETE /api/shows/:id': return removeShow(db, user, id);
      case 'POST /api/watched': return setWatched(db, now, user, await body());
      case 'GET /api/books': return listBooks(db, now, user);
      case 'POST /api/books/read': return setRead(db, now, user, await body());
      case 'GET /api/export': return exportDatabase(db, now);
      default: return error(404, 'not found');
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(controller.cron === BOOKS_CRON ? refreshBooks(env) : refresh(env));
  },
};
