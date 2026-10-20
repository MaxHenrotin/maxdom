const episodeKey = ({ season, number }) => `${season}x${number}`;

// TV Time created_at values are "YYYY-MM-DD HH:MM:SS", so the smallest string is the earliest date.
const earliest = (dates) => dates.filter(Boolean).sort()[0];

export function collectTvTimeShows({ userSeries, followed, watches }) {
  const ids = new Set([
    ...userSeries.map((row) => row.s_id),
    ...followed.map((row) => row.tv_show_id),
    ...watches.map((row) => row.s_id),
  ]);
  const shows = new Map();
  for (const tvdbId of ids) {
    const series = userSeries.find((row) => row.s_id === tvdbId);
    const follow = followed.find((row) => row.tv_show_id === tvdbId);
    const watchRows = watches.filter((row) => row.s_id === tvdbId);

    // A show with neither a user-series nor a followed row was unfollowed.
    let stopped = true;
    if (series) stopped = series.is_archived === 'true' || series.is_followed === 'false';
    else if (follow) stopped = follow.archived === '1' || follow.active === '0';

    const names = [series?.series_name, follow?.tv_show_name, ...watchRows.map((row) => row.series_name)];
    shows.set(tvdbId, {
      tvdbId,
      name: names.map((name) => name?.trim()).find(Boolean) ?? null,
      stopped,
      addedAt: earliest([series, follow, ...watchRows].filter(Boolean).map((row) => row.created_at)),
      hasUserSeries: Boolean(series),
      watches: watchRows
        .filter((row) => row.is_special !== 'true')
        .map((row) => ({ season: Number(row.season_number), number: Number(row.episode_number), watchedAt: row.created_at })),
    });
  }
  return shows;
}

export function mergeByTvmaze(resolved) {
  return [...Map.groupBy(resolved, (entry) => entry.tvmazeId)].map(([tvmazeId, entries]) => {
    const records = entries.map((entry) => entry.tvTime);
    const owner = records.find((record) => record.hasUserSeries);
    const watches = new Map();
    for (const watch of records.flatMap((record) => record.watches)) {
      const kept = watches.get(episodeKey(watch));
      if (!kept || watch.watchedAt < kept.watchedAt) watches.set(episodeKey(watch), watch);
    }
    return {
      tvmazeId,
      stopped: owner ? owner.stopped : records.every((record) => record.stopped),
      addedAt: earliest(records.map((record) => record.addedAt)),
      watches: [...watches.values()],
    };
  });
}

export function matchEpisodes(watches, episodeRows) {
  const episodeIds = new Map(episodeRows.map((episode) => [episodeKey(episode), episode.id]));
  const matched = [];
  const unmatched = [];
  for (const watch of watches) {
    const episodeId = episodeIds.get(episodeKey(watch));
    if (episodeId === undefined) unmatched.push({ season: watch.season, number: watch.number });
    else matched.push({ episodeId, watchedAt: watch.watchedAt });
  }
  return { matched, unmatched };
}

const sqlValue = (value) => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
};

const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(sqlValue).join(', ')});`;

// No BEGIN/COMMIT: remote D1 rejects transaction statements in SQL files.
export function seedSql(entries) {
  const lines = ['DELETE FROM watched;', 'DELETE FROM episodes;', 'DELETE FROM shows;'];
  for (const { show, episodes, stopped, addedAt, watched } of entries) {
    lines.push(insert('shows', { ...show, stopped: stopped ? 1 : 0, added_at: addedAt }));
    for (const episode of episodes) lines.push(insert('episodes', episode));
    for (const { episodeId, watchedAt } of watched) {
      lines.push(insert('watched', { episode_id: episodeId, watched_at: watchedAt }));
    }
  }
  return `${lines.join('\n')}\n`;
}
