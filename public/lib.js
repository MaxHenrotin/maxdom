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

// The interface takes the colour of what is on screen: a category key, "series-N", or '' for neutral.
export const setAccent = (name) => { document.documentElement.dataset.accent = name; };

export const icon = (path) => `<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><path d="${path}"/></svg>`;

export const ICONS = {
  back: 'M11 4L6 9l5 5',
  check: 'M4 9.5l3.2 3L14 6',
  plus: 'M9 3v12M3 9h12',
  download: 'M9 3v8M5.5 7.5L9 11l3.5-3.5M4 14.5h10',
  logout: 'M7 4H4.5v10H7M10 6l3 3-3 3M13 9H7',
};
