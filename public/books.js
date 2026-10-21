import { ICONS, api, esc, frenchDate, icon, localDate, number, setAccent } from './lib.js';

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
const at = (col) => `--col: ${col}; --colour: var(--series-${col}); --on-colour: var(--on-series-${col})`;

// Rows of each series' first and last volume, so its branch starts and stops at their circles.
function spans(books) {
  const span = SERIES.map(() => null);
  books.forEach((book, row) => {
    const col = series(book);
    span[col] = [span[col]?.[0] ?? row, row];
  });
  return span;
}

// A row is 46px high with its circle in the middle; in an open row the circle's spot is the
// first 46px, so a branch ending there stops 23px down.
function branches(span, row) {
  return span.map((range, col) => {
    if (!range || row < range[0] || row > range[1]) return '';
    const top = row === range[0] ? '23px' : '0';
    const bottom = row === range[1] ? 'calc(100% - 23px)' : '0';
    return `<span class="branch" style="${at(col)}; top: ${top}; bottom: ${bottom}"></span>`;
  }).join('');
}

function node(book) {
  const state = book.read_at ? 'read' : book.released ? '' : 'unreleased';
  const label = `${SERIES[series(book)].short} ${book.volume} : ${book.title}`;
  return `<button class="node ${state}" data-book="${esc(book.id)}" style="${at(series(book))}" aria-label="${esc(label)}">${book.read_at ? icon(ICONS.check) : book.volume}</button>`;
}

// summary is undefined while it loads, '' when there is none.
function card(book, books, summary) {
  const { short, name } = SERIES[series(book)];
  const sameSeries = books.filter((other) => other.series === book.series).sort((a, b) => a.volume - b.volume);
  const index = sameSeries.indexOf(book);
  const link = (other, text) => (other ? `<button class="pill" data-book="${esc(other.id)}">${text}</button>` : '<span></span>');
  let label = `Paraît le ${frenchDate(book.published)}`;
  if (book.read_at) label = `Lu le ${localDate(book.read_at)}`;
  else if (book.released) label = 'Marquer comme lu';
  return `
    <div class="book-card">
      <div class="book-head">
        ${book.cover_url ? `<img class="poster" src="${esc(book.cover_url)}" alt="">` : '<div class="poster"></div>'}
        <div>
          <span class="chip">${esc(name)} · Tome ${book.volume}</span>
          <div class="book-title">${esc(book.title)}</div>
          <div class="muted">${book.released ? 'Paru' : 'Paraît'} le ${frenchDate(book.published)}</div>
        </div>
      </div>
      <button class="read-button" data-read aria-pressed="${Boolean(book.read_at)}" ${book.released ? '' : 'disabled'}>
        ${book.read_at ? icon(ICONS.check) : ''}${label}
      </button>
      ${summary === undefined ? '<p class="show-summary loading"></p>' : summary ? `<button class="show-summary" data-summary><span>${esc(summary)}</span></button>` : ''}
      <div class="book-links">
        ${link(sameSeries[index - 1], `‹ ${short} ${sameSeries[index - 1]?.volume}`)}
        ${link(sameSeries[index + 1], `${short} ${sameSeries[index + 1]?.volume} ›`)}
      </div>
    </div>`;
}

export async function renderBooks(main) {
  let books = await api('/books');
  const summaries = new Map();
  let openId = null;

  // render() replaces main.onclick when another page opens; a late redraw must not land on it.
  const onPage = () => main.onclick === onClick;

  // The open volume's card takes the place of its circle, in the colour of its series.
  function draw() {
    if (!onPage()) return;
    const span = spans(books);
    const released = books.filter((book) => book.released).length;
    const read = books.filter((book) => book.read_at).length;
    const open = books.find((book) => book.id === openId);
    let year = null;
    setAccent(open ? `series-${series(open)}` : '');
    main.innerHTML = `
      <header class="page-header">
        <div>
          <h1>Aquilon</h1>
          <p class="recap"><strong>${number(read)}</strong> / ${number(released)} tomes lus</p>
        </div>
      </header>
      <div class="tree">
        <div class="columns"><div>${SERIES.map(({ short }, col) => `<span style="${at(col)}">${short}</span>`).join('')}</div></div>
        ${books.map((book, row) => {
          const bookYear = book.published.slice(0, 4);
          const label = bookYear === year ? '' : `<span class="year">${bookYear}</span>`;
          year = bookYear;
          const content = book === open ? card(book, books, summaries.get(book.id)) : node(book);
          return `<div class="book-row ${book === open ? 'open' : ''}" style="${at(series(book))}">${label}${branches(span, row)}${content}</div>`;
        }).join('')}
      </div>`;
  }

  // The card opens before its summary arrives: the summary is cut to four lines, so a
  // four-line placeholder keeps the card's height. A failure just removes the placeholder.
  async function loadSummary(id) {
    const summary = await api(`/books/${id}/summary`).then((data) => data.summary, () => '');
    summaries.set(id, summary);
    const slot = onPage() && openId === id && main.querySelector('.book-row.open .show-summary.loading');
    if (!slot) return;
    if (summary) {
      slot.outerHTML = `<button class="show-summary" data-summary><span>${esc(summary)}</span></button>`;
    } else {
      slot.remove();
    }
  }

  // null closes the open card.
  function open(id) {
    openId = id;
    draw();
    if (id && !summaries.has(id)) loadSummary(id);
  }

  async function toggleRead(button) {
    const book = books.find(({ id }) => id === openId);
    button.setAttribute('aria-pressed', !book.read_at);
    try {
      await api('/books/read', { method: 'POST', body: { bookIds: [book.id], read: !book.read_at } });
      books = await api('/books');
    } catch (error) {
      alert(`Erreur : ${error.message}`);
    }
    draw();
  }

  function onClick({ target }) {
    const book = target.closest('[data-book]');
    const readButton = target.closest('[data-read]');
    const summary = target.closest('[data-summary]');
    if (book) open(book.dataset.book);
    else if (readButton) toggleRead(readButton);
    else if (summary) summary.classList.toggle('open');
    // A tap anywhere but on the card closes it.
    else if (openId && !target.closest('.book-card, a')) open(null);
  }

  main.onclick = onClick;
  draw();
  main.querySelector('.node:not(.read):not(.unreleased)')?.scrollIntoView({ block: 'center' });
}
