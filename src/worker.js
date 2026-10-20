import { categorize } from './categories.js';
import { upsertShowStatements } from './db.js';
import { toEpisodeRows, toShowRow, tvmazeGet } from './tvmaze.js';

const error = (status, message) => Response.json({ error: message }, { status });

// SUM over a LEFT JOIN is NULL for a show without episodes, hence the COALESCE.
const SUMMARY_SQL = `
  SELECT s.id, s.name, s.status, s.image_url, s.premiered_year, s.stopped,
    COALESCE(SUM(w.episode_id IS NOT NULL), 0) AS seen,
    COALESCE(SUM(e.airdate <= ?1), 0) AS aired,
    COALESCE(SUM(e.airdate <= ?1 AND w.episode_id IS NULL), 0) AS airedUnseen
  FROM shows s
  LEFT JOIN episodes e ON e.show_id = s.id
  LEFT JOIN watched w ON w.episode_id = e.id`;

function toSummary({ airedUnseen, ...row }) {
  const stopped = Boolean(row.stopped);
  return { ...row, stopped, category: categorize({ stopped, status: row.status, seen: row.seen, airedUnseen }) };
}

async function listShows(db, today) {
  const { results } = await db.prepare(`${SUMMARY_SQL} GROUP BY s.id`).bind(today).all();
  return Response.json(results.map(toSummary));
}

async function getShow(db, today, id) {
  const show = await db
    .prepare('SELECT id, name, status, image_url, premiered_year, stopped FROM shows WHERE id = ?1')
    .bind(id)
    .first();
  if (!show) return error(404, 'unknown show');
  const { results } = await db
    .prepare(`
      SELECT e.id, e.season, e.number, e.name, e.airdate, w.episode_id IS NOT NULL AS watched
      FROM episodes e LEFT JOIN watched w ON w.episode_id = e.id
      WHERE e.show_id = ?1
      ORDER BY e.season, e.number`)
    .bind(id)
    .all();
  return Response.json({
    ...show,
    stopped: Boolean(show.stopped),
    today,
    episodes: results.map((ep) => ({ ...ep, watched: Boolean(ep.watched) })),
  });
}

async function addShow(db, today, { tvmazeId }) {
  if (!Number.isInteger(tvmazeId)) return error(400, 'tvmazeId must be an integer');
  if (await db.prepare('SELECT 1 FROM shows WHERE id = ?1').bind(tvmazeId).first()) {
    return error(409, 'already in the list');
  }
  const json = await tvmazeGet(`/shows/${tvmazeId}?embed=episodes`);
  if (!json) return error(404, 'unknown show');
  await db.batch(upsertShowStatements(db, toShowRow(json), toEpisodeRows(json)));
  const summary = await db.prepare(`${SUMMARY_SQL} WHERE s.id = ?2 GROUP BY s.id`).bind(today, tvmazeId).first();
  return Response.json(toSummary(summary), { status: 201 });
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
async function setWatched(db, today, { episodeIds, watched }) {
  if (!Array.isArray(episodeIds) || !episodeIds.every(Number.isInteger) || typeof watched !== 'boolean') {
    return error(400, 'expected { episodeIds: number[], watched: boolean }');
  }
  const ids = JSON.stringify(episodeIds);
  if (watched) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO watched (episode_id, watched_at)
        SELECT id, ?2 FROM episodes
        WHERE id IN (SELECT value FROM json_each(?1)) AND airdate IS NOT NULL AND airdate <= ?3`)
      .bind(ids, new Date().toISOString(), today)
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
    const today = new Date().toISOString().slice(0, 10);
    const body = () => request.json().then((json) => json ?? {}, () => ({}));
    const db = env.DB;

    switch (route) {
      case 'GET /api/shows': return listShows(db, today);
      case 'GET /api/shows/:id': return getShow(db, today, id);
      case 'POST /api/shows': return addShow(db, today, await body());
      case 'PATCH /api/shows/:id': return setStopped(db, id, await body());
      case 'DELETE /api/shows/:id': return removeShow(db, id);
      case 'POST /api/watched': return setWatched(db, today, await body());
      default: return error(404, 'not found');
    }
  },
};
