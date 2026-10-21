export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Reads are kept until the page reloads, which spares D1 and makes pages already seen open at
// once. Any write may change any read, so it empties the cache, and a read that a write
// overtook isn't kept: the server may have answered it before or after the write.
const cache = new Map();
let writes = 0;

// Throws on a non-OK response; the error carries the HTTP status.
export async function api(path, { method = 'GET', body } = {}) {
  const read = method === 'GET';
  if (read && cache.has(path)) return cache.get(path);
  const writesBefore = writes;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!read) {
    writes++;
    cache.clear();
  }
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status });
  if (read && writes === writesBefore) cache.set(path, data);
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
  warning: 'M9 2.5l7 12.5H2zM9 7.5v3.5M9 13.2v.1',
};

// Applies new markup to a container by changing only what differs, so the elements that stay
// keep their running transitions and animations (a ticked check, the category indicator).
export function patch(container, html) {
  const next = document.createElement(container.tagName);
  next.innerHTML = html;
  update(container, next);
}

function update(current, next) {
  const nodes = [...current.childNodes];
  const others = [...next.childNodes];
  if (nodes.length !== others.length) {
    current.replaceChildren(...others);
    return;
  }
  nodes.forEach((node, i) => {
    const other = others[i];
    if (node.isEqualNode(other)) return;
    if (node.nodeType !== Node.ELEMENT_NODE || node.nodeName !== other.nodeName) {
      node.replaceWith(other);
      return;
    }
    for (const { name } of [...node.attributes]) if (!other.hasAttribute(name)) node.removeAttribute(name);
    for (const { name, value } of [...other.attributes]) if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    update(node, other);
  });
}

// A summary cut to two lines, with a button that shows the rest. Without text it is a
// placeholder of the same size, for a summary still loading.
export const summaryBlock = (text, open) => (text === undefined
  ? '<p class="summary loading"></p><button class="more concealed" disabled>Voir plus</button>'
  : `<p class="summary${open ? ' open' : ''}">${esc(text)}</p><button class="more" data-more>${open ? 'Voir moins' : 'Voir plus'}</button>`);

// "Voir plus" only stays when a closed summary is longer than its two lines. With keepSpace,
// a useless button is hidden rather than removed, so the layout keeps its height.
export function trimMore(container, keepSpace = false) {
  for (const more of container.querySelectorAll('[data-more]')) {
    const text = more.previousElementSibling;
    if (text.classList.contains('open') || text.scrollHeight > text.clientHeight) continue;
    if (keepSpace) more.classList.add('concealed');
    else more.remove();
  }
}
