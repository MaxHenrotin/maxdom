// The publisher's site has no API, so the catalogue is read from its HTML pages.

// Column order of the tree.
export const SERIES = [
  { slug: 'elfes', name: 'Elfes' },
  { slug: 'nains', name: 'Nains' },
  { slug: 'orcs-et-gobelins', name: 'Orcs & Gobelins' },
  { slug: 'mages', name: 'Mages' },
  { slug: 'terres-ogon', name: "Terres d'Ogon" },
  { slug: 'guerres-d-arran', name: "Guerres d'Arran" },
  { slug: 'terres-d-ynuma', name: "Terres d'Ynuma" },
];

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', laquo: '«', raquo: '»',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code] ?? entity;
    return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  });
}

const text = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Each volume is an <a class="item"> holding its cover, "Paru le dd/mm/yyyy", "Elfes T37" and its title.
export function parseListing(html, seriesName) {
  const books = [];
  for (const [, id, item] of html.matchAll(/<a href="[^"]*\/livre\/([^/"]+)\/" class="item">([\s\S]*?)<\/a>/g)) {
    const volume = text(item.match(/<p class="categorie">([\s\S]*?)<\/p>/)?.[1] ?? '').match(/T(\d+)/)?.[1];
    const date = item.match(/<div class="date">[^<]*?(\d\d)\/(\d\d)\/(\d{4})/);
    if (!volume || !date) continue;
    books.push({
      id,
      series: seriesName,
      volume: Number(volume),
      title: text(item.match(/<p class="titre">([\s\S]*?)<\/p>/)?.[1] ?? ''),
      published: `${date[3]}-${date[2]}-${date[1]}`,
      cover_url: item.match(/data-src="([^"]+)"/)?.[1].replace(/^http:\/\//, 'https://') ?? null,
    });
  }
  const pages = Math.max(1, ...[...html.matchAll(/\/catalogue\/[^/"]+\/page\/(\d+)\//g)].map((m) => Number(m[1])));
  return { books, pages };
}

export function parseSummary(html) {
  return text(html.match(/<div class="resume">([\s\S]*?)<\/div>/)?.[1] ?? '');
}

// Special editions are listed as their own entries; the standard one has the shortest slug.
// Crossover volumes ("Orcs et Gobelins T24 – Guerres d'Arran") also appear in the Guerres
// d'Arran listing; the first listing in column order is the volume's own series.
export function dedupeEditions(books) {
  const byId = new Map();
  for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
  const byVolume = new Map();
  for (const book of byId.values()) {
    const key = `${book.series}/${book.volume}`;
    if (!byVolume.has(key) || book.id.length < byVolume.get(key).id.length) byVolume.set(key, book);
  }
  return [...byVolume.values()];
}

const column = (book) => SERIES.findIndex((series) => series.name === book.series);

export const sortBooks = (books) =>
  [...books].sort((a, b) => a.published.localeCompare(b.published) || column(a) - column(b) || a.volume - b.volume);
