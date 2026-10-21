import { renderBooks } from './books.js';
import { ICONS, api, esc, frenchDate, icon, localDate, number, patch, setAccent } from './lib.js';

const CATEGORIES = [
  {
    key: 'in_progress',
    label: 'En cours',
    icon: 'M5.5 3.5l9 5.5-9 5.5z',
    empty: 'Rien en cours. Une série dans <a href="#/tab/watch_later">À voir</a> ?',
  },
  {
    key: 'waiting',
    label: 'En attente',
    icon: 'M9 2.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM9 5.5V9l2.5 2',
    empty: 'Aucune série en attente de la suite.',
  },
  {
    key: 'ended',
    label: 'Terminées',
    icon: 'M3.5 9.5l3.5 3.5 7.5-8',
    empty: "Aucune série terminée pour l'instant.",
  },
  {
    key: 'stopped',
    label: 'Arrêtées',
    icon: 'M5 5h8v8H5z',
    empty: 'Aucune série arrêtée.',
  },
  {
    key: 'watch_later',
    label: 'À voir',
    icon: 'M4.5 2.5h9v13l-4.5-3.5-4.5 3.5z',
    empty: "Rien à voir pour l'instant. <a href='#/add'>Ajouter une série</a>",
  },
];

const STATUS = {
  Running: 'En diffusion',
  Ended: 'Terminée',
  'To Be Determined': 'Avenir incertain',
  'In Development': 'En développement',
};

const main = document.querySelector('main');
const footer = document.querySelector('footer');
const tabbar = document.querySelector('.tabbar');

// True once the user moved inside the app, so "Retour" can go back in history.
let navigated = false;

async function tvmaze(path) {
  const res = await fetch(`https://api.tvmaze.com${path}`);
  if (!res.ok) throw new Error(`TVmaze HTTP ${res.status}`);
  return res.json();
}

// TVmaze summaries are HTML; only their text is shown.
const htmlText = (html) => (html ? new DOMParser().parseFromString(html, 'text/html').body.textContent : '');

const poster = (url) => (url ? `<img class="poster" src="${esc(url)}" alt="" loading="lazy">` : '<div class="poster"></div>');

const backLink = `<a class="back" href="#/" data-back aria-label="Retour">${icon(ICONS.back)}</a>`;

const percent = (show) => (show.aired ? Math.min(100, Math.round((100 * show.seen) / show.aired)) : 0);

// A progress ring in the colour of the show's category, with the share seen in its centre.
function ring(pct, size, stroke) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `
    <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${pct} % vu">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      ${pct > 0 ? `<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
      <text x="50%" y="50%" dy="0.35em">${pct} %</text>
    </svg>`;
}

// Counts calendar days in local time, so an episode airing tomorrow at 3am is one day away.
function daysUntil(airstamp) {
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day(new Date(airstamp)) - day(new Date())) / 86_400_000);
}

// A known date is highlighted; an unknown one stays plain text.
const countdown = (show) => (show.next_airstamp
  ? `<span class="chip">Prochain : J-${daysUntil(show.next_airstamp)}</span>`
  : '<span class="chip plain">Prochain : J-?</span>');

const minutes = (show) => `${number(show.minutes)} / ${number(show.aired_minutes)} min`;

// Switching category patches the page: the header and the category bar stay, so the bar's
// indicator slides and the colours fade to the new category.
async function renderHome(category) {
  const shows = await api('/shows');
  const inTab = shows
    .filter((show) => show.category === category.key)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'fr'));
  const count = (key) => shows.filter((show) => show.category === key).length;
  const seen = number(shows.reduce((sum, show) => sum + show.seen, 0));
  setAccent(category.key);
  patch(main, `
    <header class="page-header">
      <div>
        <h1>Séries</h1>
        <p class="recap"><strong>${seen}</strong> épisodes vus</p>
      </div>
      <a class="fab" href="#/add" aria-label="Ajouter une série">${icon(ICONS.plus)}</a>
    </header>
    <nav class="categories card" aria-label="Catégories" style="--index: ${CATEGORIES.indexOf(category)}">
      <span class="indicator"></span>
      ${CATEGORIES.map(({ key, label, icon: path }) => `
        <a class="${key}" href="#/tab/${key}" aria-label="${label}" title="${label}" ${key === category.key ? 'aria-current="page"' : ''}>
          ${icon(path)}<span>${count(key)}</span>
        </a>`).join('')}
    </nav>
    <div class="tab-list">
      <h2 class="tab-title">${category.label} <span>${inTab.length} ${inTab.length < 2 ? 'série' : 'séries'}</span></h2>
      ${inTab.length === 0 ? `<p class="empty card">${category.empty}</p>` : `
        <ul class="shows ${category.key}">
          ${inTab.map((show) => `
            <li><a class="card show-row" href="#/show/${show.id}">
              ${poster(show.image_url)}
              <div class="show-info">
                <div class="show-name">${esc(show.name)}</div>
                <div class="progress-text">${show.seen} / ${show.aired} épisodes<br>${minutes(show)}</div>
                ${category.key === 'waiting' ? countdown(show) : ''}
              </div>
              ${ring(percent(show), 66, 6)}
            </a></li>`).join('')}
        </ul>`}
    </div>`);
}

function episodeDetails(episode, info) {
  const summary = htmlText(info.summary);
  const facts = [
    episode.watched_at && `Vu le ${frenchDate(episode.watched_at)}`,
    info.runtime && `${info.runtime} min`,
    info.rating?.average && `Note TVmaze : ${info.rating.average} / 10`,
  ].filter(Boolean);
  return `
    <div class="episode-details">
      ${info.image ? `<img src="${esc(info.image.medium)}" alt="" loading="lazy">` : ''}
      ${facts.length > 0 ? `<ul class="facts">${facts.map((fact) => `<li>${esc(fact)}</li>`).join('')}</ul>` : ''}
      <p>${summary ? esc(summary) : 'Pas de résumé.'}</p>
    </div>`;
}

// A stopped show keeps its ticks but takes no new ones until it is resumed.
function episodeRow(episode, aired, locked, info, popped) {
  let date = 'Date inconnue';
  if (episode.airstamp) date = aired ? localDate(episode.airstamp) : `Diffusion le ${localDate(episode.airstamp)}`;
  return `
    <li class="episode ${aired ? '' : 'unaired'}">
      <button class="check${popped ? ' pop' : ''}" data-episode="${episode.id}" aria-pressed="${episode.watched}" aria-label="Vu" ${aired && !(locked && !episode.watched) ? '' : 'disabled'}>${icon(ICONS.check)}</button>
      <button class="episode-main" data-details="${episode.id}" aria-expanded="${Boolean(info)}">
        <span class="episode-number">${episode.number}</span>
        <span class="episode-text">
          <span class="episode-name">${esc(episode.name ?? '')}</span>
          <span class="episode-date">${date}</span>
        </span>
      </button>
      ${info ? episodeDetails(episode, info) : ''}
    </li>`;
}

async function renderShow(id) {
  // The series summary is a nice-to-have: the page still opens when TVmaze is unreachable.
  const [show, tvmazeShow] = await Promise.all([api(`/shows/${id}`), tvmaze(`/shows/${id}`).catch(() => null)]);
  const summary = htmlText(tvmazeShow?.summary);
  const isAired = (episode) => episode.airstamp !== null && episode.airstamp <= show.now;
  const toTick = (episodes) => episodes.filter((episode) => isAired(episode) && !episode.watched);
  const seasonDone = (episodes) => episodes.some(isAired) && toTick(episodes).length === 0;
  const episodeInfo = new Map();
  const openEpisodes = new Set();
  let summaryOpen = false;
  // The episode just ticked keeps its bounce through the redraw that follows.
  let popped = null;

  function draw(openSeasons) {
    setAccent(show.category);
    const seasons = Map.groupBy(show.episodes, (episode) => episode.season);
    // Only a show being watched can be stopped: not one never started ("À voir") nor one
    // finished ("Terminées"). A stopped one can always be resumed.
    const stopped = show.category === 'stopped';
    const stoppable = stopped || show.category === 'in_progress' || show.category === 'waiting';
    const category = CATEGORIES.find(({ key }) => key === show.category);
    const status = STATUS[show.status] ?? show.status;
    patch(main, `
      ${backLink}
      <section class="card show-header ${show.category}">
        ${poster(show.image_url)}
        <div class="show-info">
          <h1>${esc(show.name)}</h1>
          <span class="chip">${category.label}${status ? ` · ${esc(status)}` : ''}</span>
          <div class="show-progress">
            ${ring(percent(show), 84, 8)}
            <p><strong>${show.seen} / ${show.aired}</strong><br>épisodes<br>${minutes(show)}</p>
          </div>
        </div>
      </section>
      ${summary ? `<button class="card show-summary ${summaryOpen ? 'open' : ''}" data-summary><span>${esc(summary)}</span></button>` : ''}
      ${stopped ? '<p class="muted hint">Reprends la série pour cocher de nouveaux épisodes.</p>' : ''}
      <div class="actions">
        ${stoppable ? `<button class="button" data-stop>${stopped ? 'Reprendre' : "J'arrête"}</button>` : ''}
        <button class="link-button" data-remove>Retirer de ma liste</button>
      </div>
      ${[...seasons].map(([season, episodes]) => `
        <details class="card season" data-season="${season}" ${openSeasons.has(season) ? 'open' : ''}>
          <summary>
            <span class="season-name">Saison ${season}</span>
            <span class="season-count ${seasonDone(episodes) ? 'done' : ''}">${episodes.filter((episode) => episode.watched).length} / ${episodes.filter(isAired).length} vus</span>
            ${!stopped && toTick(episodes).length > 0 ? `<button class="button small" data-season-all="${season}">Tout marquer vu</button>` : ''}
          </summary>
          <ul class="episodes">
            ${episodes.map((ep) => episodeRow(ep, isAired(ep), stopped, openEpisodes.has(ep.id) && episodeInfo.get(ep.id), ep.id === popped)).join('')}
          </ul>
        </details>`).join('')}`);
    popped = null;
  }

  const setWatched = (episodes, watched) =>
    api('/watched', { method: 'POST', body: { episodeIds: episodes.map((episode) => episode.id), watched } });

  const redraw = () => draw(new Set([...main.querySelectorAll('details[open]')].map((details) => Number(details.dataset.season))));

  async function handle(target) {
    if (target.dataset.episode) {
      const episode = show.episodes.find((ep) => ep.id === Number(target.dataset.episode));
      // Ticked right away; the redraw below, or the one after an error, sets the real state.
      target.setAttribute('aria-pressed', !episode.watched);
      target.classList.toggle('pop', !episode.watched);
      popped = episode.watched ? null : episode.id;
      await setWatched([episode], !episode.watched);
    } else if (target.dataset.details) {
      const episodeId = Number(target.dataset.details);
      if (!openEpisodes.delete(episodeId)) {
        if (!episodeInfo.has(episodeId)) episodeInfo.set(episodeId, await tvmaze(`/episodes/${episodeId}`));
        openEpisodes.add(episodeId);
      }
    } else if (target.dataset.seasonAll) {
      const season = Number(target.dataset.seasonAll);
      await setWatched(toTick(show.episodes.filter((episode) => episode.season === season)), true);
    } else if (target.hasAttribute('data-stop')) {
      await api(`/shows/${show.id}`, { method: 'PATCH', body: { stopped: !show.stopped } });
    } else if (target.hasAttribute('data-remove')) {
      if (!confirm(`Retirer « ${show.name} » de ta liste ? Les épisodes cochés seront perdus.`)) return;
      await api(`/shows/${show.id}`, { method: 'DELETE' });
      location.hash = '#/';
      return;
    }
    // Reload so counts, category and watched dates come from the server.
    if (!target.dataset.details) Object.assign(show, await api(`/shows/${show.id}`));
    redraw();
  }

  main.onclick = (event) => {
    const summaryText = event.target.closest('[data-summary]');
    if (summaryText) {
      summaryOpen = !summaryOpen;
      summaryText.classList.toggle('open', summaryOpen);
      return;
    }
    const target = event.target.closest('button');
    if (!target) return;
    // A button inside <summary> would also toggle the season.
    event.preventDefault();
    handle(target).catch((error) => {
      alert(`Erreur : ${error.message}`);
      redraw();
    });
  };

  draw(new Set([toTick(show.episodes)[0]?.season]));
}

function resultRow(show, inList) {
  return `
    <li class="card result">
      ${poster(show.image?.medium)}
      <div class="show-info">
        <div class="show-name">${esc(show.name)}</div>
        <div class="progress-text">${show.premiered?.slice(0, 4) ?? ''}</div>
      </div>
      ${inList ? '<span class="in-list">Déjà dans ta liste</span>' : `<button class="button" data-add="${show.id}">Ajouter</button>`}
    </li>`;
}

async function renderAdd() {
  const inList = new Set((await api('/shows')).map((show) => show.id));
  setAccent('');
  main.innerHTML = `
    ${backLink}
    <header class="page-header"><h1>Ajouter une série</h1></header>
    <form class="search">
      <input class="card" type="search" name="q" placeholder="Rechercher une série" aria-label="Rechercher une série" autofocus>
    </form>
    <ul class="shows results"></ul>`;
  const results = main.querySelector('.results');

  main.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const query = event.target.q.value.trim();
    if (!query) return;
    try {
      const found = await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`);
      results.innerHTML = found.length === 0
        ? '<p class="empty card">Rien ici.</p>'
        : found.map(({ show }) => resultRow(show, inList.has(show.id))).join('');
    } catch (error) {
      results.innerHTML = `<p class="empty card">Erreur : ${esc(error.message)}</p>`;
    }
  };

  main.onclick = async (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    button.disabled = true;
    try {
      await api('/shows', { method: 'POST', body: { tvmazeId: Number(button.dataset.add) } });
      location.hash = '#/tab/watch_later';
    } catch (error) {
      if (error.status === 409) {
        button.outerHTML = '<span class="in-list">Déjà dans ta liste</span>';
      } else {
        button.disabled = false;
        alert(`Erreur : ${error.message}`);
      }
    }
  };
}

// The logout link is Cloudflare Access's own, so it only works online.
async function renderProfile() {
  const { email } = await api('/me');
  setAccent('');
  main.innerHTML = `
    <header class="page-header"><h1>Profil</h1></header>
    <section class="card profile-id">
      <span class="avatar" aria-hidden="true">${esc(email[0].toUpperCase())}</span>
      <div>
        <p class="muted">Connecté avec</p>
        <p class="email">${esc(email)}</p>
      </div>
    </section>
    <section class="card menu">
      <a href="/api/export" download>
        ${icon(ICONS.download)}
        <span><strong>Télécharger mes données</strong><small>Tes séries et tes tomes lus, au format SQL</small></span>
      </a>
      <a href="/cdn-cgi/access/logout">${icon(ICONS.logout)}<span>Se déconnecter</span></a>
    </section>`;
}

// Each part credits where its data comes from; the profile shows none.
const FOOTERS = {
  series: '<a href="https://www.tvmaze.com">Données : TVmaze</a>',
  books: '<a href="https://www.monde-aquilon.com">Données : Monde d\'Aquilon</a>',
  profile: '',
};

// Each page swaps in its content once its data has arrived. The footer, the tab bar and the
// scroll position change in the same frame, so the old page never shows the new page's state.
// The page the last render showed, so a switch between two series categories can be told apart.
let shownPage = null;

async function update(route, param) {
  const category = (route === 'tab' && CATEGORIES.find(({ key }) => key === param)) || CATEGORIES[0];
  const section = route === 'books' || route === 'profile' ? route : 'series';
  main.onclick = null;
  try {
    if (route === 'show') await renderShow(Number(param));
    else if (route === 'add') await renderAdd();
    else if (route === 'books') await renderBooks(main);
    else if (route === 'profile') await renderProfile();
    else await renderHome(category);
  } catch (error) {
    main.innerHTML = `<p class="empty card">Erreur : ${esc(error.message)}</p>`;
  }
  footer.innerHTML = FOOTERS[section];
  document.body.dataset.screen = route === 'show' || route === 'add' ? 'detail' : section;
  tabbar.style.setProperty('--index', ['series', 'books', 'profile'].indexOf(section));
  for (const link of tabbar.querySelectorAll('a')) {
    if (link.dataset.section === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  // Aquilon scrolls itself to the first unread volume.
  if (route !== 'books') window.scrollTo(0, 0);
}

// The browser keeps a picture of the old page on screen until the new one is ready, then
// blends them (style.css); between two categories only the list blends, so the bar stays sharp.
function render() {
  const [, route, param] = location.hash.split('/');
  const page = route === 'tab' || !route ? 'home' : route;
  document.documentElement.classList.toggle('category-switch', page === 'home' && shownPage === 'home');
  shownPage = page;
  if (document.startViewTransition) document.startViewTransition(() => update(route, param));
  else update(route, param);
}

// Opened straight on a show or the add page, "Retour" falls back to its href (home).
document.addEventListener('click', (event) => {
  if (navigated && event.target.closest('[data-back]')) {
    event.preventDefault();
    history.back();
  }
});

window.addEventListener('hashchange', () => {
  navigated = true;
  render();
});
render();
