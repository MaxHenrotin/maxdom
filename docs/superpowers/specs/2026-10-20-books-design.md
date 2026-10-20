# Books section: design

## Why

I also track my reading of the Chroniques d'Aquilon comics (the Arran universe: Elfes, Nains, Orcs & Gobelins, and so on) in a separate app, Aquillon (`~/Desktop/Aquillon`, React on Vercel, public, one progress list per pseudo). I want that tracking inside this app instead, just for me. This is a copy of the idea, not a port: the publication tree and the full list of volumes, in the style of this app.

I open it in two moments:

1. Right after finishing a volume, to tick it. This happens most, so it has to be quick.
2. At the library, to decide what to read next. Usually that's the first unread volume in global publication order, sometimes the next volume of a series I'm enjoying. The tree has to show at a glance where I am overall and in each series.

## What it does

1. A switch at the top of the app, "Séries | Livres", moves between the existing series part and a new books part. The two parts don't share screens.
2. The books part shows every Aquilon volume as a tree: one column per series, one row per volume, rows in global publication order.
3. Tapping a volume's circle opens its card inside the tree, at that spot. From the card I can tick the volume as read or unread, and jump to the previous or next volume of the same series.
4. The list of volumes keeps itself up to date from monde-aquilon.com.

## Goals, non-goals, anti-goals

Goals:
- Ticking a volume I just read takes two taps: its circle, then "Lu".
- The tree reads like Aquillon's: you see the series as branches and what's read along each.
- Same look and feel as the series part: sober, phone first, light and dark.

Non-goals:
- Any book outside the Aquilon catalogue.
- Importing my progress from Aquillon. I'll tick the 60 or so volumes by hand once.
- Reproducing Aquillon's visuals or features one to one.
- Touching the Aquillon project. It stays online as it is for its other users.

Anti-goals:
- The lore recap bands Aquillon inserts in its timeline. I don't want them.
- Pseudos, logins, filters, stats.
- A separate page per volume. The card opens inside the tree.

## Data

Two new tables (a new migration):

- `books`: id (the site's slug, like `mages-t04`), series, volume number, title (the volume's own title, like "Arundill"), publication date, cover URL.
- `books_read`: book id (primary key), `read_at`.

Global order is computed on read: by publication date, then by series in the column order below, then by volume number. 28 dates are shared by several volumes, so the tie-break matters.

The seven series, in column order, with the colours Aquillon uses:

| Series | Site slug | Colour |
|---|---|---|
| Elfes | `elfes` | #eab308 |
| Nains | `nains` | #d97706 |
| Orcs & Gobelins | `orcs-et-gobelins` | #16a34a |
| Mages | `mages` | #7c3aed |
| Terres d'Ogon | `terres-ogon` | #b45309 |
| Guerres d'Arran | `guerres-d-arran` | #dc2626 |
| Terres d'Ynuma | `terres-d-ynuma` | #0891b2 |

Today that's 132 volumes.

## Catalogue from monde-aquilon.com

There's no book API that covers this catalogue properly (Open Library has about half of Nains, Google Books needs a key and Bédéthèque has no public API), so the catalogue is scraped from the publisher's site like Aquillon does. `~/Desktop/Aquillon/api/books.ts` and `api/synopsis.ts` are the reference:

- Each series has listing pages at `https://www.monde-aquilon.com/catalogue/<slug>/`, paginated with `/page/<n>/` links (Elfes has 4 pages).
- On a listing, `p.categorie` holds "Elfes T35", `p.titre` the volume's title, `div.date` the publication date and `img[data-src]` the cover (rewrite `http://` to `https://`).
- The site lists some special editions as separate entries. Keep one entry per series and volume number, the one with the shortest slug. Drop entries without a volume number.
- A volume's summary is on `https://www.monde-aquilon.com/livre/<slug>/`, in `.resume`.

A second cron trigger in the Worker, separate from the TVmaze refresh, scrapes all listings once a week and upserts the `books` table. It never deletes a volume, so a failed page or a volume pulled from the site can't wipe what I ticked; whatever was fetched before a failure is still saved (my call). It needs about 16 page fetches. The Workers free plan allows 50 subrequests per run, and the TVmaze refresh already budgets for most of that, so the two jobs must not share an invocation. `scheduled()` picks the job from `controller.cron`. The first fill of the local database is the same job, triggered by hand like the TVmaze cron.

Summaries are not stored. The card asks the Worker for one when it opens (`GET /api/books/:id/summary`), and the Worker fetches the volume's page and returns the text. The site doesn't send CORS headers, so the browser can't fetch it directly like it does with TVmaze. The card still opens if the summary fails.

A volume published after today (the site already lists Elfes T37 for 12/11/2026) is shown in the tree but can't be ticked, like an unaired episode.

## API

- `GET /api/books`: every volume, in global order, with a `read` flag and `read_at`.
- `GET /api/books/:id/summary`: `{ summary }`, scraped live.
- `POST /api/books/read` `{ "bookIds": [..], "read": true }`: ticks or unticks, same shape as `/api/watched`. Only published volumes can be ticked.

## Screens

**Switch.** At the very top of the series home and of the books screen, a two-button pill, "Séries | Livres", in the app's accent colour, the active one filled. The show page and the add screen keep their "‹ Retour" and don't show it (my call). Routes: the series part keeps its hashes, the books part lives at `#/books`. The app still opens on the series part.

**Books header.** "Livres" with, next to it in small type, "57 / 131 lus": volumes read over volumes published to date, so an announced volume doesn't count until it's out (my call). Below, a row of short column labels in the series colours: Elfes, Nains, Orcs, Mages, Ogon, Guerres, Ynuma. That row sticks to the top of the screen while the tree scrolls, since the tree is about 4,000 px tall and the columns are hard to tell apart without it (my call).

**Tree.**
- On the left, a narrow gutter with the year, shown on the first row of each year.
- Then seven equal columns across the width. Each row is one volume, placed in its series' column.
- Each series is a vertical line in its colour (about 45% opacity), from its first volume to its last.
- An unread volume is an empty circle outlined in its series colour. A read volume is the same green ticked circle as a watched episode (`.check[aria-pressed="true"]`). An unpublished volume is greyed out, like an unaired episode.
- The whole tree scrolls with the page. Opening the books screen scrolls straight to the first unread published volume in global order, so the read part sits above and what to read next is in view.

**Opening a card.** Tapping a circle opens that volume's card in place. The animation matters:
1. The circle grows into the card: its outline, in the series colour, widens and loses its roundness until it is a rounded rectangle almost the full width of the tree. At the same time the tree spreads apart at that row to make room, so the rows below slide down.
2. Once the card has its size, its content fades in.
3. Closing plays it backwards: the content fades out, the card shrinks back into the circle, and the tree closes up.
4. The other series' lines keep running behind the card, which has a slightly see-through background. It should look like the tree stretched, not like a window placed on top of it.
5. Only one card is open at a time. Opening another one, from the tree or from the card's previous/next links, closes the open one first.
6. Tapping anywhere outside the card closes it. Taps inside the card only work its buttons.

The shape change takes about 0.45 s and the content fades in near its end. The clickable prototype that set these timings was removed once the feature was built; it's in the git history as `docs/superpowers/specs/2026-10-20-books-prototype.html`.

**Card content.** Same layout as the show page header, smaller:
- the cover on the left;
- the volume's title, then the series name in its colour and "Tome 4", then "Paru le 26/08/2020";
- the "Lu" circle from the episode rows, with "Pas encore lu" next to it, or "Lu le 20/10/2026" once ticked. Ticking updates the circle in the tree and the "lus" count;
- the summary, cut to four lines until tapped, like the series summary;
- at the bottom, "‹ Mages 3" and "Mages 5 ›" links to the neighbouring volumes of the same series, when they exist.

## Testing

Unit tests (Vitest) for the parts that are pure: parsing a listing page and a volume page from saved HTML samples, deduplicating editions, and the global order with its tie-break. The API gets tests like `test/worker.test.js`. The screens and the animation get checked by hand against `wrangler dev`, on a phone-sized window, in light and dark.

## Left to the builder

- How to parse the HTML in the Worker (HTMLRewriter or plain string matching; no heavy dependency).
- The exact cron schedule for the books job.
- File layout for the front end. `public/app.js` is 300 lines; splitting the books part into its own module is fine.
- Dark-mode variants of the series colours, if some don't read well on the dark background.
- How the animation is built (CSS transitions on size and radius, or the Web Animations API), as long as it behaves as described.
