const CATEGORIES = [
  ['in_progress', 'En cours'],
  ['watch_later', 'Pas commencées'],
  ['waiting', 'En attente'],
  ['ended', 'Terminées'],
  ['stopped', 'Arrêtées'],
];

const STATUS = {
  Running: 'En diffusion',
  Ended: 'Terminée',
  'To Be Determined': 'Avenir incertain',
  'In Development': 'En développement',
};

const main = document.querySelector('main');

// True once the user moved inside the app, so "Retour" can go back in history.
let navigated = false;

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Throws on a non-OK response; the error carries the HTTP status.
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
  return data;
}

async function tvmaze(path) {
  const res = await fetch(`https://api.tvmaze.com${path}`);
  if (!res.ok) throw new Error(`TVmaze HTTP ${res.status}`);
  return res.json();
}

const poster = (url) => (url ? `<img class="poster" src="${esc(url)}" alt="" loading="lazy">` : '<div class="poster"></div>');

const backLink = '<a class="back" href="#/" data-back>‹ Retour</a>';

// Accepts "YYYY-MM-DD" with or without a time part.
const frenchDate = (date) => date.slice(0, 10).split('-').reverse().join('/');

const progress = (seen, aired, category) => `
  <div class="progress-text">${seen} / ${aired} épisodes</div>
  <div class="bar ${category}"><span style="width: ${aired ? Math.min(100, (100 * seen) / aired) : 0}%"></span></div>`;

async function renderHome(tab) {
  const shows = await api('/shows');
  const inTab = shows
    .filter((show) => show.category === tab)
    .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name, 'fr'));
  main.innerHTML = `
    <div class="header">
      <h1>Séries</h1>
      <a class="button" href="#/add">Ajouter une série</a>
    </div>
    <nav class="tabs">
      ${CATEGORIES.map(([key, label]) => `
        <a href="#/tab/${key}" ${key === tab ? 'aria-current="page"' : ''}>
          <span class="tab-count">${shows.filter((show) => show.category === key).length}</span>
          <span class="tab-label">${label}</span>
        </a>`).join('')}
    </nav>
    ${inTab.length === 0 ? '<p class="empty">Rien ici.</p>' : `
      <ul class="shows">
        ${inTab.map((show) => `
          <li><a href="#/show/${show.id}">
            ${poster(show.image_url)}
            <div class="show-info">
              <div class="show-name">${esc(show.name)}</div>
              ${progress(show.seen, show.aired, show.category)}
            </div>
          </a></li>`).join('')}
      </ul>`}`;
}

// TVmaze summaries are HTML; only their text is shown.
function episodeDetails(episode, info) {
  const summary = info.summary ? new DOMParser().parseFromString(info.summary, 'text/html').body.textContent : '';
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
  if (episode.airdate) date = aired ? frenchDate(episode.airdate) : `Diffusion le ${frenchDate(episode.airdate)}`;
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
  const show = await api(`/shows/${id}`);
  const isAired = (episode) => episode.airdate !== null && episode.airdate <= show.today;
  const toTick = (episodes) => episodes.filter((episode) => isAired(episode) && !episode.watched);
  const episodeInfo = new Map();
  const openEpisodes = new Set();

  function draw(openSeasons) {
    const seasons = Map.groupBy(show.episodes, (episode) => episode.season);
    main.innerHTML = `
      ${backLink}
      <div class="show-header">
        ${poster(show.image_url)}
        <div class="show-info">
          <h1>${esc(show.name)}</h1>
          <div class="status">${esc(STATUS[show.status] ?? show.status ?? '')}</div>
          ${progress(show.seen, show.aired, show.category)}
        </div>
      </div>
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

  async function handle(target) {
    if (target.dataset.episode) {
      const episode = show.episodes.find((ep) => ep.id === Number(target.dataset.episode));
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
    draw(new Set([...main.querySelectorAll('details[open]')].map((details) => Number(details.dataset.season))));
  }

  main.onclick = (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    // A button inside <summary> would also toggle the season.
    event.preventDefault();
    handle(target).catch((error) => alert(`Erreur : ${error.message}`));
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

async function render() {
  const [, route, param] = location.hash.split('/');
  const known = CATEGORIES.some(([key]) => key === param);
  main.onclick = null;
  window.scrollTo(0, 0);
  try {
    if (route === 'show') await renderShow(Number(param));
    else if (route === 'add') await renderAdd();
    else await renderHome(route === 'tab' && known ? param : 'in_progress');
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
