const CATEGORIES = [
  ['in_progress', 'En cours'],
  ['watch_later', 'À regarder plus tard'],
  ['waiting', 'En attente de la suite'],
  ['ended', 'Terminées'],
  ['stopped', 'Arrêtées'],
];

const main = document.querySelector('main');

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

const poster = (url) => (url ? `<img class="poster" src="${esc(url)}" alt="" loading="lazy">` : '<div class="poster"></div>');

const progress = (seen, aired) => `
  <div class="progress-text">${seen} / ${aired} épisodes</div>
  <div class="bar"><span style="width: ${aired ? Math.min(100, (100 * seen) / aired) : 0}%"></span></div>`;

async function renderHome(tab) {
  const shows = await api('/shows');
  const inTab = shows.filter((show) => show.category === tab).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  main.innerHTML = `
    <div class="header">
      <h1>Séries</h1>
      <a class="button" href="#/add">Ajouter une série</a>
    </div>
    <nav class="tabs">
      ${CATEGORIES.map(([key, label]) => `
        <a href="#/tab/${key}" ${key === tab ? 'aria-current="page"' : ''}>
          ${label} (${shows.filter((show) => show.category === key).length})
        </a>`).join('')}
    </nav>
    ${inTab.length === 0 ? '<p class="empty">Rien ici.</p>' : `
      <ul class="shows">
        ${inTab.map((show) => `
          <li><a href="#/show/${show.id}">
            ${poster(show.image_url)}
            <div class="show-info">
              <div class="show-name">${esc(show.name)}</div>
              ${progress(show.seen, show.aired)}
            </div>
          </a></li>`).join('')}
      </ul>`}`;
  main.querySelector('[aria-current="page"]').scrollIntoView({ block: 'nearest', inline: 'center' });
}

async function render() {
  const [, route, param] = location.hash.split('/');
  const known = CATEGORIES.some(([key]) => key === param);
  try {
    await renderHome(route === 'tab' && known ? param : 'in_progress');
  } catch (error) {
    main.innerHTML = `<p class="empty">Erreur : ${esc(error.message)}</p>`;
  }
}

window.addEventListener('hashchange', render);
render();
