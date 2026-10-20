import { api, esc, number, sectionSwitch } from './lib.js';

// Column order of the tree. Their colours are --series-0 to --series-6 in style.css.
const SERIES = [
  { name: 'Elfes', short: 'Elfes' },
  { name: 'Nains', short: 'Nains' },
  { name: 'Orcs & Gobelins', short: 'Orcs' },
  { name: 'Mages', short: 'Mages' },
  { name: "Terres d'Ogon", short: 'Ogon' },
  { name: "Guerres d'Arran", short: 'Guerres' },
  { name: "Terres d'Ynuma", short: 'Ynuma' },
];

const series = (book) => SERIES.findIndex(({ name }) => name === book.series);

// Places an element on a series' column; the CSS turns --col into a left offset.
const at = (col) => `--col: ${col}; --colour: var(--series-${col})`;

// Rows of each series' first and last volume, so its branch starts and stops at their circles.
function spans(books) {
  const span = SERIES.map(() => null);
  books.forEach((book, row) => {
    const col = series(book);
    span[col] = [span[col]?.[0] ?? row, row];
  });
  return span;
}

function branches(span, row) {
  return span.map((range, col) => {
    if (!range || row < range[0] || row > range[1]) return '';
    const top = row === range[0] ? '15px' : '0';
    const bottom = row === range[1] ? '15px' : '0';
    return `<span class="branch" style="${at(col)}; top: ${top}; bottom: ${bottom}"></span>`;
  }).join('');
}

function node(book) {
  const state = book.read_at ? 'read' : book.released ? '' : 'unreleased';
  const label = `${SERIES[series(book)].short} ${book.volume} : ${book.title}`;
  return `<button class="node ${state}" data-book="${esc(book.id)}" style="${at(series(book))}" aria-label="${esc(label)}"></button>`;
}

export async function renderBooks(main) {
  const books = await api('/books');
  const span = spans(books);
  const released = books.filter((book) => book.released).length;
  const read = books.filter((book) => book.read_at).length;
  let year = null;

  main.innerHTML = `
    ${sectionSwitch('books')}
    <div class="header">
      <h1>Livres</h1>
      <div class="recap"><strong>${number(read)}</strong> / ${number(released)} lus</div>
    </div>
    <div class="tree">
      <div class="columns">${SERIES.map(({ short }, col) => `<span style="${at(col)}">${short}</span>`).join('')}</div>
      ${books.map((book, row) => {
        const bookYear = book.published.slice(0, 4);
        const label = bookYear === year ? '' : `<span class="year">${bookYear}</span>`;
        year = bookYear;
        return `<div class="book-row">${label}${branches(span, row)}${node(book)}</div>`;
      }).join('')}
    </div>`;

  main.querySelector('.node:not(.read):not(.unreleased)')?.scrollIntoView({ block: 'center' });
}
