import { SERIES, dedupeEditions, parseListing } from './aquilon.js';

const SITE = 'https://www.monde-aquilon.com';

// Runs in its own invocation: the TVmaze refresh already uses most of the 50 subrequests.
export const BOOKS_CRON = '0 6 * * 1';

async function fetchPage(path) {
  const res = await fetch(`${SITE}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

// Walks the listings in column order and stops at the first failure; what was read
// until then is saved, and next week's run tries again. Volumes are never deleted,
// so a broken page can't take read ticks with it.
async function scrapeCatalogue() {
  const books = [];
  try {
    for (const { slug, name } of SERIES) {
      const first = parseListing(await fetchPage(`/catalogue/${slug}/`), name);
      books.push(...first.books);
      for (let page = 2; page <= first.pages; page++) {
        books.push(...parseListing(await fetchPage(`/catalogue/${slug}/page/${page}/`), name).books);
      }
    }
  } catch (error) {
    console.error('Aquilon catalogue:', error.message);
  }
  return dedupeEditions(books);
}

// One statement whatever the catalogue size, so the run costs a single D1 query.
export async function refreshBooks(env) {
  const books = await scrapeCatalogue();
  if (books.length > 0) {
    await env.DB.prepare(`
      INSERT INTO books (id, series, volume, title, published, cover_url)
      SELECT value ->> 'id', value ->> 'series', value ->> 'volume', value ->> 'title', value ->> 'published', value ->> 'cover_url'
      FROM json_each(?1) WHERE true
      ON CONFLICT (id) DO UPDATE SET
        series = excluded.series,
        volume = excluded.volume,
        title = excluded.title,
        published = excluded.published,
        cover_url = excluded.cover_url`)
      .bind(JSON.stringify(books))
      .run();
  }
  return { saved: books.length };
}
