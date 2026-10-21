// Episodes TVmaze no longer lists (deleted, or turned into specials) are removed with every account's watched rows.
export function upsertShowStatements(db, show, episodes) {
  const insertShow = db.prepare(`
    INSERT INTO shows (id, name, status, image_url, premiered_year, tvmaze_updated)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      image_url = excluded.image_url,
      premiered_year = excluded.premiered_year,
      tvmaze_updated = excluded.tvmaze_updated`);
  // One statement whatever the number of episodes: D1 caps the queries per Worker invocation.
  const insertEpisodes = db.prepare(`
    INSERT INTO episodes (id, show_id, season, number, name, airstamp, runtime)
    SELECT value ->> 'id', value ->> 'show_id', value ->> 'season', value ->> 'number', value ->> 'name', value ->> 'airstamp', value ->> 'runtime'
    FROM json_each(?1) WHERE true
    ON CONFLICT (id) DO UPDATE SET
      season = excluded.season,
      number = excluded.number,
      name = excluded.name,
      airstamp = excluded.airstamp,
      runtime = excluded.runtime`);
  const stale = 'SELECT id FROM episodes WHERE show_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))';
  const episodeIds = JSON.stringify(episodes.map((ep) => ep.id));
  return [
    insertShow.bind(show.id, show.name, show.status, show.image_url, show.premiered_year, show.tvmaze_updated),
    insertEpisodes.bind(JSON.stringify(episodes)),
    db.prepare(`DELETE FROM watched WHERE episode_id IN (${stale})`).bind(show.id, episodeIds),
    db.prepare(`DELETE FROM episodes WHERE id IN (${stale})`).bind(show.id, episodeIds),
  ];
}
