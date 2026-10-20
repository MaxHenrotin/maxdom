import { upsertShowStatements } from './db.js';
import { toEpisodeRows, toShowRow, tvmazeGet } from './tvmaze.js';

// The free plan allows 50 subrequests per run, D1 queries included.
const MAX_SHOWS_PER_RUN = 40;

export function pickShowsToRefresh(myShows, updates, limit = MAX_SHOWS_PER_RUN) {
  return myShows
    .filter((show) => updates[show.id] > show.tvmaze_updated)
    .sort((a, b) => a.tvmaze_updated - b.tvmaze_updated)
    .slice(0, limit)
    .map((show) => show.id);
}

// Shows over the limit are picked up on the next run, since the update list covers a week.
export async function refresh(env) {
  const updates = await tvmazeGet('/updates/shows?since=week');
  const { results } = await env.DB.prepare('SELECT id, tvmaze_updated FROM shows').all();
  const statements = [];
  let refreshed = 0;
  for (const id of pickShowsToRefresh(results, updates)) {
    const json = await tvmazeGet(`/shows/${id}?embed=episodes`);
    if (!json) continue;
    statements.push(...upsertShowStatements(env.DB, toShowRow(json), toEpisodeRows(json)));
    refreshed++;
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return { refreshed };
}
