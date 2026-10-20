import { BOOKS_CRON, getSummary, listBooks, refreshBooks, setRead } from './books.js';
import { categorize } from './categories.js';
import { upsertShowStatements } from './db.js';
import { error } from './http.js';
import { refresh } from './refresh.js';
import { toEpisodeRows, toShowRow, tvmazeGet } from './tvmaze.js';

// SUM over a LEFT JOIN is NULL for a show without episodes, hence the COALESCE.
const SUMMARY_SQL = `
  SELECT s.id, s.name, s.status, s.image_url, s.premiered_year, s.stopped,
    COALESCE(SUM(w.episode_id IS NOT NULL), 0) AS seen,
    COALESCE(SUM(CASE WHEN w.episode_id IS NOT NULL THEN e.runtime END), 0) AS minutes,
    COALESCE(SUM(CASE WHEN e.airstamp <= ?1 THEN e.runtime END), 0) AS aired_minutes,
    COALESCE(SUM(e.airstamp <= ?1), 0) AS aired,
    COALESCE(SUM(e.airstamp <= ?1 AND w.episode_id IS NULL), 0) AS airedUnseen,
    MIN(CASE WHEN e.airstamp > ?1 THEN e.airstamp END) AS next_airstamp
  FROM shows s
  LEFT JOIN episodes e ON e.show_id = s.id
  LEFT JOIN watched w ON w.episode_id = e.id`;

function toSummary({ airedUnseen, ...row }) {
  const stopped = Boolean(row.stopped);
  return { ...row, stopped, category: categorize({ stopped, status: row.status, seen: row.seen, airedUnseen }) };
}

async function listShows(db, now) {
  const { results } = await db.prepare(`${SUMMARY_SQL} GROUP BY s.id`).bind(now).all();
  return Response.json(results.map(toSummary));
}

const showSummary = (db, now, id) =>
  db.prepare(`${SUMMARY_SQL} WHERE s.id = ?2 GROUP BY s.id`).bind(now, id).first();

async function getShow(db, now, id) {
  const show = await showSummary(db, now, id);
  if (!show) return error(404, 'unknown show');
  const { results } = await db
    .prepare(`
      SELECT e.id, e.season, e.number, e.name, e.airstamp, w.watched_at
      FROM episodes e LEFT JOIN watched w ON w.episode_id = e.id
      WHERE e.show_id = ?1
      ORDER BY e.season, e.number`)
    .bind(id)
    .all();
  return Response.json({
    ...toSummary(show),
    now,
    episodes: results.map((ep) => ({ ...ep, watched: ep.watched_at !== null })),
  });
}

async function addShow(db, now, { tvmazeId }) {
  if (!Number.isInteger(tvmazeId)) return error(400, 'tvmazeId must be an integer');
  if (await db.prepare('SELECT 1 FROM shows WHERE id = ?1').bind(tvmazeId).first()) {
    return error(409, 'already in the list');
  }
  const json = await tvmazeGet(`/shows/${tvmazeId}?embed=episodes`);
  if (!json) return error(404, 'unknown show');
  await db.batch(upsertShowStatements(db, toShowRow(json), toEpisodeRows(json)));
  return Response.json(toSummary(await showSummary(db, now, tvmazeId)), { status: 201 });
}

async function setStopped(db, id, { stopped }) {
  if (typeof stopped !== 'boolean') return error(400, 'stopped must be a boolean');
  const { meta } = await db.prepare('UPDATE shows SET stopped = ?1 WHERE id = ?2').bind(stopped ? 1 : 0, id).run();
  if (meta.changes === 0) return error(404, 'unknown show');
  return Response.json({ ok: true });
}

async function removeShow(db, id) {
  await db.batch([
    db.prepare('DELETE FROM watched WHERE episode_id IN (SELECT id FROM episodes WHERE show_id = ?1)').bind(id),
    db.prepare('DELETE FROM episodes WHERE show_id = ?1').bind(id),
    db.prepare('DELETE FROM shows WHERE id = ?1').bind(id),
  ]);
  return Response.json({ ok: true });
}

// Only aired episodes can be ticked, whatever the client sends.
async function setWatched(db, now, { episodeIds, watched }) {
  if (!Array.isArray(episodeIds) || !episodeIds.every(Number.isInteger) || typeof watched !== 'boolean') {
    return error(400, 'expected { episodeIds: number[], watched: boolean }');
  }
  const ids = JSON.stringify(episodeIds);
  if (watched) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO watched (episode_id, watched_at)
        SELECT id, ?2 FROM episodes
        WHERE id IN (SELECT value FROM json_each(?1)) AND airstamp IS NOT NULL AND airstamp <= ?2`)
      .bind(ids, now)
      .run();
  } else {
    await db.prepare('DELETE FROM watched WHERE episode_id IN (SELECT value FROM json_each(?1))').bind(ids).run();
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

    // Book ids are slugs, which the numeric :id pattern above doesn't cover.
    const summary = pathname.match(/^\/api\/books\/([a-z0-9-]+)\/summary$/);
    if (request.method === 'GET' && summary) return getSummary(db, summary[1]);

    switch (route) {
      case 'GET /api/shows': return listShows(db, now);
      case 'GET /api/shows/:id': return getShow(db, now, id);
      case 'POST /api/shows': return addShow(db, now, await body());
      case 'PATCH /api/shows/:id': return setStopped(db, id, await body());
      case 'DELETE /api/shows/:id': return removeShow(db, id);
      case 'POST /api/watched': return setWatched(db, now, await body());
      case 'GET /api/books': return listBooks(db, now);
      case 'POST /api/books/read': return setRead(db, now, await body());
      default: return error(404, 'not found');
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(controller.cron === BOOKS_CRON ? refreshBooks(env) : refresh(env));
  },
};
