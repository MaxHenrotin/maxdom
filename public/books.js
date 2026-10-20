import { api, esc, frenchDate, localDate, number, sectionSwitch } from './lib.js';

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

// In an open row the circle sits on the first 30px, so a branch ending there stops at 15px.
function branches(span, row) {
  return span.map((range, col) => {
    if (!range || row < range[0] || row > range[1]) return '';
    const top = row === range[0] ? '15px' : '0';
    const bottom = row === range[1] ? 'calc(100% - 15px)' : '0';
    return `<span class="branch" style="${at(col)}; top: ${top}; bottom: ${bottom}"></span>`;
  }).join('');
}

function node(book) {
  const state = book.read_at ? 'read' : book.released ? '' : 'unreleased';
  const label = `${SERIES[series(book)].short} ${book.volume} : ${book.title}`;
  return `<button class="node ${state}" data-book="${esc(book.id)}" style="${at(series(book))}" aria-label="${esc(label)}"></button>`;
}

// summary is undefined while it loads, '' when there is none.
function card(book, books, summary) {
  const { short, name } = SERIES[series(book)];
  const sameSeries = books.filter((other) => other.series === book.series).sort((a, b) => a.volume - b.volume);
  const index = sameSeries.indexOf(book);
  const link = (other, text) => (other ? `<button class="link-button" data-book="${esc(other.id)}">${text}</button>` : '<span></span>');
  return `
    <div class="book-card">
      <div class="book-head">
        ${book.cover_url ? `<img class="poster" src="${esc(book.cover_url)}" alt="">` : '<div class="poster"></div>'}
        <div>
          <div class="book-title">${esc(book.title)}</div>
          <div><span class="book-series">${esc(name)}</span> · Tome ${book.volume}</div>
          <div class="status">${book.released ? 'Paru' : 'Paraît'} le ${frenchDate(book.published)}</div>
          <div class="book-read">
            <button class="check" data-read aria-pressed="${Boolean(book.read_at)}" aria-label="Lu" ${book.released ? '' : 'disabled'}></button>
            <span>${book.read_at ? `Lu le ${localDate(book.read_at)}` : 'Pas encore lu'}</span>
          </div>
        </div>
      </div>
      ${summary === undefined ? '<p class="show-summary loading"></p>' : summary ? `<p class="show-summary">${esc(summary)}</p>` : ''}
      <div class="book-links">
        ${link(sameSeries[index - 1], `‹ ${short} ${sameSeries[index - 1]?.volume}`)}
        ${link(sameSeries[index + 1], `${short} ${sameSeries[index + 1]?.volume} ›`)}
      </div>
    </div>`;
}

// The open card grows out of its circle: the shell's box and the row's height run from
// the circle's size (.growing in style.css) to the card's, then the content fades in.
// Closing plays it backwards.
const GROW_MS = 450;
const FADE_IN_AT_MS = 380;
const FADE_OUT_MS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// Transitions need pixel sizes at both ends; once open, the card sizes itself so the summary can expand.
function pinToCard(row) {
  const box = { left: '0px', top: '0px', width: `${row.clientWidth}px`, height: `${row.scrollHeight - 8}px`, borderRadius: '14px' };
  Object.assign(row.querySelector('.shell').style, box);
  row.style.height = `${row.scrollHeight}px`;
}

function unpin(row) {
  row.querySelector('.shell').removeAttribute('style');
  row.style.height = '';
}

export async function renderBooks(main) {
  let books = await api('/books');
  const summaries = new Map();
  let openId = null;
  let busy = false;

  const openRow = () => main.querySelector('.book-row.open');
  // render() replaces main.onclick when another page opens; a late redraw must not land on it.
  const onPage = () => main.onclick === onClick;

  function draw({ growing = false } = {}) {
    if (!onPage()) return;
    const span = spans(books);
    const released = books.filter((book) => book.released).length;
    const read = books.filter((book) => book.read_at).length;
    let year = null;
    main.innerHTML = `
      ${sectionSwitch('books')}
      <div class="header">
        <div class="recap"><strong>${number(read)}</strong> / ${number(released)} lus</div>
      </div>
      <div class="tree">
        <div class="columns">${SERIES.map(({ short }, col) => `<span style="${at(col)}">${short}</span>`).join('')}</div>
        ${books.map((book, row) => {
          const bookYear = book.published.slice(0, 4);
          const label = bookYear === year ? '' : `<span class="year">${bookYear}</span>`;
          year = bookYear;
          if (book.id !== openId) return `<div class="book-row">${label}${branches(span, row)}${node(book)}</div>`;
          return `
            <div class="book-row open ${growing ? 'growing hidden' : 'settled'}" style="${at(series(book))}">
              ${label}${branches(span, row)}
              <div class="shell"></div>
              ${card(book, books, summaries.get(book.id))}
            </div>`;
        }).join('')}
      </div>`;
  }

  async function grow() {
    const row = openRow();
    await nextFrame();
    pinToCard(row);
    row.classList.remove('growing');
    await wait(FADE_IN_AT_MS);
    row.classList.remove('hidden');
    await wait(GROW_MS - FADE_IN_AT_MS);
    unpin(row);
    row.classList.add('settled');
  }

  async function shrink() {
    const row = openRow();
    if (!row) return;
    pinToCard(row);
    row.classList.remove('settled');
    row.classList.add('hidden');
    await wait(FADE_OUT_MS);
    unpin(row);
    row.classList.add('growing');
    await wait(GROW_MS);
    openId = null;
    draw();
  }

  // The card opens before its summary arrives: the summary is cut to four lines, so a
  // four-line placeholder keeps the card's height. A failure just removes the placeholder.
  async function loadSummary(id) {
    const summary = await api(`/books/${id}/summary`).then((data) => data.summary, () => '');
    summaries.set(id, summary);
    const slot = onPage() && openId === id && openRow().querySelector('.show-summary.loading');
    if (!slot) return;
    if (summary) {
      slot.textContent = summary;
      slot.classList.remove('loading');
    } else {
      slot.remove();
    }
  }

  async function open(id) {
    await shrink();
    openId = id;
    draw({ growing: true });
    if (!summaries.has(id)) loadSummary(id);
    await grow();
  }

  async function toggleRead(check) {
    const book = books.find(({ id }) => id === openId);
    check.setAttribute('aria-pressed', !book.read_at);
    try {
      await api('/books/read', { method: 'POST', body: { bookIds: [book.id], read: !book.read_at } });
      books = await api('/books');
    } catch (error) {
      alert(`Erreur : ${error.message}`);
    }
    draw();
  }

  async function handle({ target }) {
    const book = target.closest('[data-book]');
    const check = target.closest('[data-read]');
    const summary = target.closest('.show-summary');
    if (book) await open(book.dataset.book);
    else if (check) await toggleRead(check);
    else if (summary) summary.classList.toggle('open');
    // A tap anywhere but on the card closes it. Links leave the page, so they don't animate.
    else if (!target.closest('.book-card, a')) await shrink();
  }

  // Taps during an animation are dropped, so two cards never move at once.
  function onClick(event) {
    if (busy) return;
    busy = true;
    handle(event).finally(() => { busy = false; });
  }

  main.onclick = onClick;
  draw();
  main.querySelector('.node:not(.read):not(.unreleased)')?.scrollIntoView({ block: 'center' });
}
