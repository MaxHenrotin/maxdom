import { SERIES, dedupeEditions, parseListing, parseSummary, sortBooks } from './aquilon.js';
import { error } from './http.js';

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

// A volume is out once its publication date is reached.
export async function listBooks(db, now) {
  const { results } = await db
    .prepare('SELECT b.*, r.read_at FROM books b LEFT JOIN books_read r ON r.book_id = b.id')
    .all();
  const today = now.slice(0, 10);
  return Response.json(sortBooks(results).map((book) => ({ ...book, released: book.published <= today })));
}

// Only volumes that are out can be ticked, whatever the client sends.
export async function setRead(db, now, { bookIds, read }) {
  if (!Array.isArray(bookIds) || !bookIds.every((id) => typeof id === 'string') || typeof read !== 'boolean') {
    return error(400, 'expected { bookIds: string[], read: boolean }');
  }
  const ids = JSON.stringify(bookIds);
  if (read) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO books_read (book_id, read_at)
        SELECT id, ?2 FROM books
        WHERE id IN (SELECT value FROM json_each(?1)) AND published <= ?3`)
      .bind(ids, now, now.slice(0, 10))
      .run();
  } else {
    await db.prepare('DELETE FROM books_read WHERE book_id IN (SELECT value FROM json_each(?1))').bind(ids).run();
  }
  return Response.json({ ok: true });
}

// The site sends no CORS headers, so the browser asks the Worker. Only known ids are
// fetched, which keeps the Worker from requesting arbitrary pages.
export async function getSummary(db, id) {
  if (!(await db.prepare('SELECT 1 FROM books WHERE id = ?1').bind(id).first())) return error(404, 'unknown book');
  try {
    return Response.json({ summary: parseSummary(await fetchPage(`/livre/${id}/`)) });
  } catch (err) {
    return error(502, err.message);
  }
}
