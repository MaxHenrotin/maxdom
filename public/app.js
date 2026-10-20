import { renderBooks } from './books.js';
import { api, esc, frenchDate, localDate, number, sectionSwitch } from './lib.js';

const icon = (shape) => `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${shape}</svg>`;

const CATEGORIES = [
  {
    key: 'in_progress',
    label: 'En cours',
    icon: icon('<path class="filled" d="M5 3l8 5-8 5z"/>'),
    empty: 'Rien en cours. Une série dans <a href="#/tab/watch_later">À voir</a> ?',
  },
  {
    key: 'waiting',
    label: 'En attente',
    icon: icon('<circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>'),
    empty: 'Aucune série en attente de la suite.',
  },
  {
    key: 'ended',
    label: 'Terminées',
    icon: icon('<path d="M3 8.5l3 3 7-7"/>'),
    empty: "Aucune série terminée pour l'instant.",
  },
  {
    key: 'stopped',
    label: 'Arrêtées',
    icon: icon('<rect class="filled" x="4" y="4" width="8" height="8" rx="1"/>'),
    empty: 'Aucune série arrêtée.',
  },
  {
    key: 'watch_later',
    label: 'À voir',
    icon: icon('<path d="M4 2h8v12l-4-3-4 3z"/>'),
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

const backLink = '<a class="back" href="#/" data-back>‹ Retour</a>';

// Counts calendar days in local time, so an episode airing tomorrow at 3am is one day away.
function daysUntil(airstamp) {
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day(new Date(airstamp)) - day(new Date())) / 86_400_000);
}

const daysLeft = (show) => `<span class="days-left">(J-${show.next_airstamp ? `<span>${daysUntil(show.next_airstamp)}</span>` : '?'})</span>`;

const progress = (show) => `
  <div class="progress-text">${show.seen} / ${show.aired} épisodes <span class="minutes">(${number(show.minutes)} / ${number(show.aired_minutes)} min)</span></div>
  <div class="bar ${show.category}"><span style="width: ${show.aired ? Math.min(100, (100 * show.seen) / show.aired) : 0}%"></span></div>`;

async function renderHome(category) {
  const shows = await api('/shows');
  const inTab = shows
    .filter((show) => show.category === category.key)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'fr'));
  const seen = number(shows.reduce((sum, show) => sum + show.seen, 0));
  main.innerHTML = `
    ${sectionSwitch('series')}
    <div class="header">
      <div class="recap"><strong>${seen}</strong> épisodes</div>
      <a class="button" href="#/add">Ajouter une série</a>
    </div>
    <nav class="tabs">
      ${CATEGORIES.map(({ key, label, icon: categoryIcon }) => `
        <a class="${key}" href="#/tab/${key}" aria-label="${label}" title="${label}" ${key === category.key ? 'aria-current="page"' : ''}>${categoryIcon}</a>`).join('')}
    </nav>
    <h2 class="tab-title">${category.label} <span>(${inTab.length} ${inTab.length < 2 ? 'série' : 'séries'})</span></h2>
    ${inTab.length === 0 ? `<p class="empty">${category.empty}</p>` : `
      <ul class="shows">
        ${inTab.map((show) => `
          <li><a href="#/show/${show.id}">
            ${poster(show.image_url)}
            <div class="show-info">
              <div class="show-title">
                <span class="show-name">${esc(show.name)}</span>
                ${category.key === 'waiting' ? daysLeft(show) : ''}
              </div>
              ${progress(show)}
            </div>
          </a></li>`).join('')}
      </ul>`}`;
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

function episodeRow(episode, aired, info) {
  let date = 'Date inconnue';
  if (episode.airstamp) date = aired ? localDate(episode.airstamp) : `Diffusion le ${localDate(episode.airstamp)}`;
  return `
    <li class="episode ${aired ? '' : 'unaired'}">
      <button class="check" data-episode="${episode.id}" aria-pressed="${episode.watched}" aria-label="Vu" ${aired ? '' : 'disabled'}></button>
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
  const episodeInfo = new Map();
  const openEpisodes = new Set();
  let summaryOpen = false;

  function draw(openSeasons) {
    const seasons = Map.groupBy(show.episodes, (episode) => episode.season);
    main.innerHTML = `
      ${backLink}
      <div class="show-header">
        ${poster(show.image_url)}
        <div class="show-info">
          <h1>${esc(show.name)}</h1>
          <div class="status">${esc(STATUS[show.status] ?? show.status ?? '')}</div>
          ${progress(show)}
        </div>
      </div>
      ${summary ? `<p class="show-summary ${summaryOpen ? 'open' : ''}">${esc(summary)}</p>` : ''}
      <div class="actions">
        <button class="button" data-stop>${show.stopped ? 'Reprendre' : "J'arrête"}</button>
        <button class="link-button" data-remove>Retirer de ma liste</button>
      </div>
      ${[...seasons].map(([season, episodes]) => `
        <details data-season="${season}" ${openSeasons.has(season) ? 'open' : ''}>
          <summary>
            <span>Saison ${season} · ${episodes.filter((episode) => episode.watched).length} / ${episodes.filter(isAired).length} vus</span>
            ${toTick(episodes).length > 0 ? `<button class="button" data-season-all="${season}">Tout marquer vu</button>` : ''}
          </summary>
          <ul class="episodes">
            ${episodes.map((ep) => episodeRow(ep, isAired(ep), openEpisodes.has(ep.id) && episodeInfo.get(ep.id))).join('')}
          </ul>
        </details>`).join('')}`;
  }

  const setWatched = (episodes, watched) =>
    api('/watched', { method: 'POST', body: { episodeIds: episodes.map((episode) => episode.id), watched } });

  const redraw = () => draw(new Set([...main.querySelectorAll('details[open]')].map((details) => Number(details.dataset.season))));

  async function handle(target) {
    if (target.dataset.episode) {
      const episode = show.episodes.find((ep) => ep.id === Number(target.dataset.episode));
      // Ticked right away; the redraw below, or the one after an error, sets the real state.
      target.setAttribute('aria-pressed', !episode.watched);
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
    const summaryText = event.target.closest('.show-summary');
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
    <li class="result">
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
  main.innerHTML = `
    ${backLink}
    <div class="header"><h1>Ajouter une série</h1></div>
    <form class="search">
      <input type="search" name="q" placeholder="Rechercher une série" autofocus>
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
        ? '<p class="empty">Rien ici.</p>'
        : found.map(({ show }) => resultRow(show, inList.has(show.id))).join('');
    } catch (error) {
      results.innerHTML = `<p class="empty">Erreur : ${esc(error.message)}</p>`;
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

function renderProfile() {
  main.innerHTML = `
    ${sectionSwitch('profile')}
    <section class="profile">
      <p>Une copie complète de ta base, séries et tomes compris, au format SQL.</p>
      <a class="button" href="/api/export" download>Télécharger ma base</a>
    </section>`;
}

// Each part credits where its data comes from; the profile shows none.
const FOOTERS = {
  series: '<a href="https://www.tvmaze.com">Données : TVmaze</a>',
  books: '<a href="https://www.monde-aquilon.com">Données : Monde d\'Aquilon</a>',
  profile: '',
};

async function render() {
  const [, route, param] = location.hash.split('/');
  const category = (route === 'tab' && CATEGORIES.find(({ key }) => key === param)) || CATEGORIES[0];
  main.onclick = null;
  footer.innerHTML = FOOTERS[route] ?? FOOTERS.series;
  window.scrollTo(0, 0);
  try {
    if (route === 'show') await renderShow(Number(param));
    else if (route === 'add') await renderAdd();
    else if (route === 'books') await renderBooks(main);
    else if (route === 'profile') renderProfile();
    else await renderHome(category);
  } catch (error) {
    main.innerHTML = `<p class="empty">Erreur : ${esc(error.message)}</p>`;
  }
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
