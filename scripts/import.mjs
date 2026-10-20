import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { toEpisodeRows, toShowRow, tvmazeGet } from '../src/tvmaze.js';
import { collectTvTimeShows, matchEpisodes, mergeByTvmaze, seedSql } from './import-lib.js';

const exportDir = process.argv[2];
const readCsv = (file) => parse(readFileSync(join(exportDir, file)), { columns: true });

// TVmaze allows about 20 calls per 10 seconds.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const get = async (path) => {
  await sleep(550);
  return tvmazeGet(path);
};

const v2 = readCsv('tracking-prod-records-v2.csv');
const tvTimeShows = collectTvTimeShows({
  userSeries: v2.filter((row) => row.key.startsWith('user-series')),
  followed: readCsv('followed_tv_show.csv'),
  watches: v2.filter((row) => row.key.startsWith('watch-episode')),
});

const resolved = [];
const byNameLines = [];
const skippedLines = [];
for (const tvTime of tvTimeShows.values()) {
  const label = `${tvTime.name ?? '(no name)'} [TV Time ${tvTime.tvdbId}]`;
  let show = await get(`/lookup/shows?thetvdb=${tvTime.tvdbId}`);
  if (show) {
    console.log(`${label}: by id`);
  } else if (tvTime.name) {
    show = await get(`/singlesearch/shows?q=${encodeURIComponent(tvTime.name)}`);
    if (show) {
      byNameLines.push(`${label} → ${show.name} [TVmaze ${show.id}]`);
      console.log(`${label}: by name → ${show.name}`);
    }
  }
  if (show) {
    resolved.push({ tvTime, tvmazeId: show.id });
  } else {
    skippedLines.push(label);
    console.log(`${label}: skipped`);
  }
}

const entries = [];
const unmatchedLines = [];
const matchedLines = [];
for (const { tvmazeId, stopped, addedAt, watches } of mergeByTvmaze(resolved)) {
  const json = await get(`/shows/${tvmazeId}?embed=episodes`);
  const show = toShowRow(json);
  const episodes = toEpisodeRows(json);
  const { matched, unmatched } = matchEpisodes(watches, episodes);
  entries.push({ show, episodes, stopped, addedAt, watched: matched });
  const label = `${show.name} [TVmaze ${show.id}]`;
  if (unmatched.length > 0) {
    unmatchedLines.push(`${label}: ${unmatched.map(({ season, number }) => `S${season}E${number}`).join(', ')}`);
  }
  matchedLines.push(`${label}: ${matched.length} episodes matched`);
  console.log(`${label}: ${matched.length} matched, ${unmatched.length} unmatched`);
}

const section = (title, lines) => `## ${title}\n\n${lines.length > 0 ? lines.join('\n') : '(none)'}\n`;
writeFileSync('data/seed.sql', seedSql(entries));
writeFileSync('data/import-report.txt', [
  section('Resolved by name', byNameLines),
  section('Skipped', skippedLines),
  section('Unmatched episodes', unmatchedLines),
  section('Matched episodes per show', matchedLines),
].join('\n'));
console.log(`${entries.length} shows written to data/seed.sql, report in data/import-report.txt`);
