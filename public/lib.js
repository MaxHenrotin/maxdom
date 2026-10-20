export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Throws on a non-OK response; the error carries the HTTP status.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
  return data;
}

export const number = (n) => n.toLocaleString('fr-FR');

// Accepts "YYYY-MM-DD" with or without a time part.
export const frenchDate = (date) => date.slice(0, 10).split('-').reverse().join('/');

// For full timestamps, shown as the date where the user is.
export const localDate = (timestamp) => new Date(timestamp).toLocaleDateString('fr-FR');

export const sectionSwitch = (active) => `
  <nav class="switch">
    <a href="#/" ${active === 'series' ? 'aria-current="page"' : ''}>Séries</a>
    <a href="#/books" ${active === 'books' ? 'aria-current="page"' : ''}>Aquilon</a>
    <a href="#/profile" ${active === 'profile' ? 'aria-current="page"' : ''}>Profil</a>
  </nav>`;
