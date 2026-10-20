// Existing shows keep their stopped flag and added_at; only TVmaze fields are refreshed.
export function upsertShowStatements(db, show, episodes) {
  const insertShow = db.prepare(`
    INSERT INTO shows (id, name, status, image_url, premiered_year, tvmaze_updated, stopped, added_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      image_url = excluded.image_url,
      premiered_year = excluded.premiered_year,
      tvmaze_updated = excluded.tvmaze_updated`);
  const insertEpisode = db.prepare(`
    INSERT INTO episodes (id, show_id, season, number, name, airdate, runtime)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (id) DO UPDATE SET
      season = excluded.season,
      number = excluded.number,
      name = excluded.name,
      airdate = excluded.airdate,
      runtime = excluded.runtime`);
  return [
    insertShow.bind(show.id, show.name, show.status, show.image_url, show.premiered_year, show.tvmaze_updated, new Date().toISOString()),
    ...episodes.map((ep) => insertEpisode.bind(ep.id, ep.show_id, ep.season, ep.number, ep.name, ep.airdate, ep.runtime)),
  ];
}
