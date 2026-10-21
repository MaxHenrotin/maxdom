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

// summary is undefined while it loads, '' when there is none. The cover and the read
// check sit on the left; the text, then the summary, on the right.
function card(book, summary) {
  let text = '';
  if (summary === undefined) text = '<p class="book-summary loading"></p>';
  else if (summary) text = `<p class="book-summary">${esc(summary)}</p><button class="more" data-more>Voir plus</button>`;
  return `
    <div class="book-card">
      <div class="book-side">
        ${book.cover_url ? `<img class="poster" src="${esc(book.cover_url)}" alt="">` : '<div class="poster"></div>'}
        <button class="check" data-read aria-pressed="${Boolean(book.read_at)}" aria-label="Lu" ${book.released ? '' : 'disabled'}>${icon(ICONS.check)}</button>
      </div>
      <div class="book-info">
        <span class="chip">${esc(book.series)} · Tome ${book.volume}</span>
        <div class="book-title">${esc(book.title)}</div>
        <p class="muted">${book.released ? 'Paru' : 'Paraît'} le ${frenchDate(book.published)}</p>
        ${book.read_at ? `<p class="muted">Lu le ${localDate(book.read_at)}</p>` : ''}
        ${text}
      </div>
    </div>`;
}

// "Voir plus" only stays when the summary is longer than the lines it is cut to.
function trimMore(main) {
  const text = main.querySelector('.book-summary:not(.loading)');
  if (text && text.scrollHeight <= text.clientHeight) main.querySelector('[data-more]').remove();
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
  const box = { left: '0px', top: '0px', width: `${row.clientWidth}px`, height: `${row.scrollHeight - 10}px`, borderRadius: '24px' };
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

  // The open volume's card takes the place of its circle, in the colour of its series.
  function draw({ growing = false } = {}) {
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
          if (book !== open) return `<div class="book-row">${label}${branches(span, row)}${node(book)}</div>`;
          return `
            <div class="book-row open ${growing ? 'growing hidden' : 'settled'}" style="${at(series(book))}">
              ${label}${branches(span, row)}
              <div class="shell"></div>
              ${card(book, summaries.get(book.id))}
            </div>`;
        }).join('')}
      </div>`;
    trimMore(main);
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

  // The card opens before its summary arrives: a placeholder keeps the card's height until
  // then. A failure just removes the placeholder.
  async function loadSummary(id) {
    const summary = await api(`/books/${id}/summary`).then((data) => data.summary, () => '');
    summaries.set(id, summary);
    const slot = onPage() && openId === id && main.querySelector('.book-summary.loading');
    if (!slot) return;
    if (summary) {
      slot.outerHTML = `<p class="book-summary">${esc(summary)}</p><button class="more" data-more>Voir plus</button>`;
      trimMore(main);
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

  async function handle({ target }) {
    const book = target.closest('[data-book]');
    const readButton = target.closest('[data-read]');
    const more = target.closest('[data-more]');
    if (book) await open(book.dataset.book);
    else if (readButton) await toggleRead(readButton);
    else if (more) {
      const expanded = main.querySelector('.book-summary').classList.toggle('open');
      more.textContent = expanded ? 'Voir moins' : 'Voir plus';
    }
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
