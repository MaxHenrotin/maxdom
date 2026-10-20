# TV show tracker implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small personal app that sorts my TV series into five categories, shows seen and unseen episodes per show, lets me add new series, and starts from my TV Time history.

**Architecture:** One Cloudflare Worker serves a vanilla JS single page from `public/` as static assets, answers a JSON API under `/api/*`, and runs a daily cron that refreshes changed shows from TVmaze. Data lives in D1 (SQLite), local through `wrangler dev` for now. A one-off Node script turns the TV Time GDPR export into a SQL seed file.

**Tech Stack:** Cloudflare Workers, D1, wrangler 4, plain HTML/CSS/JS (no framework, no build), Node ≥ 22, Vitest, csv-parse, TVmaze API.

**Spec:** `docs/superpowers/specs/2026-10-20-tvtime-tracker-design.md`. Read it before starting. It holds the reasons behind the rules below.

## Global constraints

- Node ≥ 22 is required (wrangler 4 and Vitest 5 refuse Node 20). The machine has Node 20.20.2 in `/usr/bin/node`. Don't upgrade it yourself: stop and ask the user. Suggest nvm (`nvm install 22`), which is per user and leaves the system Node alone.
- JavaScript ES modules everywhere (`"type": "module"`). No TypeScript, no bundler, no front-end framework.
- UI text is in French, with the exact strings from the Copy section below. Code, comments, commit messages and README are in English.
- `data/`, `gdpr-data.zip`, `node_modules/` and `.wrangler/` are never committed. `data/` holds the GDPR export and the generated seed, which contain personal data.
- Commit messages never mention Claude or carry a co-author line for it. Never push.
- An episode is aired when `airdate` is not null and `airdate <= today`, with `today` = `new Date().toISOString().slice(0, 10)` (UTC). Compare strings, since both are `YYYY-MM-DD`.
- Category keys, in tab order: `in_progress`, `watch_later`, `waiting`, `ended`, `stopped`.
- The TVmaze base URL is `https://api.tvmaze.com`. Only store regular episodes (episodes with a non-null `number`).
- The Workers free plan allows 50 subrequests per invocation, and D1 queries count toward it. The cron refreshes at most 40 shows per run.

## Copy (exact French UI strings)

| Where | Text |
|---|---|
| Tabs | `En cours`, `À regarder plus tard`, `En attente de la suite`, `Terminées`, `Arrêtées` (each followed by its count, e.g. `En cours (12)`) |
| Empty tab | `Rien ici.` |
| Progress | `34 / 62 épisodes` (seen / aired) |
| TVmaze status | `Running` → `En diffusion`, `Ended` → `Terminée`, `To Be Determined` → `Avenir incertain`, `In Development` → `En développement`, anything else → shown as is |
| Home button | `Ajouter une série` |
| Show page | `J'arrête`, `Reprendre`, `Retirer de ma liste` |
| Remove confirmation | `Retirer « <name> » de ta liste ? Les épisodes cochés seront perdus.` |
| Season header | `Saison 2 · 8 / 10 vus` and button `Tout marquer vu` |
| Unaired episode | `Diffusion le 12/03/2027`, or `Date inconnue` if `airdate` is null |
| Add screen | input placeholder `Rechercher une série`, button `Ajouter`, label `Déjà dans ta liste` |
| Footer | `Données : TVmaze` linking to `https://www.tvmaze.com` |

## Review focus

1. Show names with apostrophes (`Inside Bill's Brain`, `The Handmaid's Tale`) must not break the seed SQL. Test in Task 4.
2. TV Time names with stray whitespace (`Harry Potter `) must be trimmed before the name search. Test in Task 4.
3. Episodes with a null `airdate` are neither aired nor tickable, and a show that has no episodes yet lands in `watch_later`. Tests in Task 2, server check in Task 6.
4. "Tout marquer vu" on a season that has unaired episodes must only tick the aired ones, and the server enforces it too. Check in Task 6.
5. Adding a show that's already in the list returns 409 and the add screen labels it `Déjà dans ta liste`. Checks in Tasks 6 and 10.

---

## File structure

```
.gitignore
package.json
wrangler.jsonc
README.md
migrations/0001_init.sql      schema
src/worker.js                 fetch router (API) + scheduled handler
src/categories.js             pure category rules
src/tvmaze.js                 TVmaze calls and JSON → row mapping (shared by Worker and import)
src/db.js                     D1 statements shared by POST /api/shows and the cron
src/refresh.js                cron logic
public/index.html             page shell
public/style.css
public/app.js                 hash router and the three screens
scripts/import-lib.js         pure TV Time import logic
scripts/import.mjs            import CLI (network + files)
test/*.test.js                Vitest unit tests for the pure modules
```

---

### Task 1: Project scaffold and schema

**Files:**
- Create: `.gitignore`, `package.json`, `wrangler.jsonc`, `migrations/0001_init.sql`, `src/worker.js`, `public/index.html`

**Interfaces:**
- Produces: D1 binding `env.DB`, assets binding `env.ASSETS`; npm scripts `dev`, `test`, `db:migrate`; tables `shows`, `episodes`, `watched`.

- [ ] **Step 1: Check Node.** Run `node --version`. If it's below 22, stop and ask the user (see Global constraints).

- [ ] **Step 2: Init the repo.** `git init`, then `.gitignore` with `node_modules/`, `.wrangler/`, `data/`, `gdpr-data.zip`. Run `git status` and confirm that `gdpr-data.zip` doesn't show up.

- [ ] **Step 3: `package.json`.** Set `"type": "module"` and `"private": true`. Dev dependencies: `wrangler`, `vitest`, `csv-parse` (install the latest versions with `npm install -D`). Scripts:
  - `"dev": "wrangler dev"`
  - `"test": "vitest run"`
  - `"db:migrate": "wrangler d1 migrations apply tvtime --local"`

- [ ] **Step 4: `wrangler.jsonc`.**

```jsonc
{
  "name": "tvtime",
  "main": "src/worker.js",
  "compatibility_date": "<today, or the latest date the installed wrangler accepts>",
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": ["/api/*"] },
  "d1_databases": [
    // database_id is a placeholder until `wrangler d1 create tvtime` at deploy time
    { "binding": "DB", "database_name": "tvtime", "database_id": "local" }
  ],
  "triggers": { "crons": ["0 5 * * *"] }
}
```

- [ ] **Step 5: `migrations/0001_init.sql`.**
  - `shows(id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT, image_url TEXT, premiered_year INTEGER, stopped INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, tvmaze_updated INTEGER NOT NULL DEFAULT 0)`
  - `episodes(id INTEGER PRIMARY KEY, show_id INTEGER NOT NULL REFERENCES shows(id), season INTEGER NOT NULL, number INTEGER NOT NULL, name TEXT, airdate TEXT, runtime INTEGER)`, plus an index on `show_id`
  - `watched(episode_id INTEGER PRIMARY KEY REFERENCES episodes(id), watched_at TEXT NOT NULL)`

- [ ] **Step 6: Minimal Worker and page.** `src/worker.js` exports `{ fetch }`, which answers every `/api/*` request with `404 {"error":"not found"}` for now. `public/index.html` is a placeholder page with `<title>Séries</title>`.

- [ ] **Step 7: Verify.** Run `npm run db:migrate`: expected `0001_init.sql` applied. Run `npm run dev`, then `curl -s localhost:8787/`, which returns the HTML, and `curl -s localhost:8787/api/x`, which returns `{"error":"not found"}`.

- [ ] **Step 8: Commit.** `git add -A && git commit -m "Scaffold Worker, D1 schema and static page"`, after checking with `git status` that nothing from `data/` or the zip is staged.

---

### Task 2: Category rules

**Files:**
- Create: `src/categories.js`, `test/categories.test.js`

**Interfaces:**
- Produces: `isAired(airdate: string|null, today: string) -> boolean`; `categorize({ stopped: boolean, status: string|null, seen: number, airedUnseen: number }) -> 'in_progress'|'watch_later'|'waiting'|'ended'|'stopped'`.

- [ ] **Step 1: Write failing tests** (`test/categories.test.js`):
  - `isAired('2026-10-20', '2026-10-20')` is true, `isAired('2026-10-21', '2026-10-20')` is false, `isAired(null, '2026-10-20')` is false
  - stopped wins: `categorize({ stopped: true, status: 'Ended', seen: 10, airedUnseen: 0 })` → `'stopped'`, and the same with `seen: 0` → `'stopped'`
  - `{ stopped: false, status: 'Running', seen: 0, airedUnseen: 5 }` → `'watch_later'`
  - a show with no episodes at all: `{ stopped: false, status: 'In Development', seen: 0, airedUnseen: 0 }` → `'watch_later'`
  - `{ stopped: false, status: 'Ended', seen: 3, airedUnseen: 2 }` → `'in_progress'`
  - `{ stopped: false, status: 'Ended', seen: 10, airedUnseen: 0 }` → `'ended'`
  - `{ stopped: false, status: 'Running', seen: 10, airedUnseen: 0 }` → `'waiting'`, and the same with `'To Be Determined'` → `'waiting'`

- [ ] **Step 2: Run** `npx vitest run test/categories.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** both functions. Rule order: stopped, then `seen === 0`, then `airedUnseen > 0`, then `status === 'Ended'`, else waiting.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `"Add category rules"`.

---

### Task 3: TVmaze client and mapping

**Files:**
- Create: `src/tvmaze.js`, `test/tvmaze.test.js`

**Interfaces:**
- Produces:
  - `tvmazeGet(path: string, retryDelayMs = 2000) -> Promise<object|null>`: GET `https://api.tvmaze.com${path}`, returns the parsed JSON, `null` on 404, retries up to 3 times on 429 (waiting `retryDelayMs`), and throws on any other non-OK status.
  - `toShowRow(json) -> { id, name, status, image_url, premiered_year, tvmaze_updated }`: `image_url` = `json.image?.medium ?? null`, `premiered_year` = first 4 characters of `json.premiered` as a number, or null; `tvmaze_updated` = `json.updated`.
  - `toEpisodeRows(json) -> Array<{ id, show_id, season, number, name, airdate, runtime }>`, from `json._embedded.episodes`, dropping episodes whose `number` is null; an empty `airdate` string becomes null; `show_id` = `json.id`.

- [ ] **Step 1: Write failing tests.** Use a small inline fixture shaped like `GET /shows/54198?embed=episodes` (id, name, status, premiered `'2022-06-23'`, image `{ medium: 'm.jpg' }`, updated `1782836072`, three episodes: one regular, one with `number: null`, one with `airdate: ''`).
  - `toShowRow` returns `{ id: 54198, name, status, image_url: 'm.jpg', premiered_year: 2022, tvmaze_updated: 1782836072 }`, and `image_url: null` when `image` is null
  - `toEpisodeRows` returns 2 rows, the special is dropped, and `airdate: ''` becomes `null`
  - `tvmazeGet` with `vi.stubGlobal('fetch', ...)`: a 404 resolves to `null`, a 429 then 200 resolves to the JSON (pass `retryDelayMs = 0`), a 500 rejects

- [ ] **Step 2: Run** `npx vitest run test/tvmaze.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** the three functions.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `"Add TVmaze client and row mapping"`.

---

### Task 4: TV Time import logic (pure)

**Files:**
- Create: `scripts/import-lib.js`, `test/import-lib.test.js`

**Interfaces:**
- Consumes: row shapes from Task 3 (`toShowRow` and `toEpisodeRows` output).
- Produces:
  - `collectTvTimeShows({ userSeries, followed, watches }) -> Map<string, TvTimeShow>`, where `TvTimeShow = { tvdbId, name, stopped, addedAt, hasUserSeries, watches: Array<{ season, number, watchedAt }> }`. The inputs are raw CSV row objects (all strings): `userSeries` = v2 rows whose `key` starts with `user-series`, `followed` = `followed_tv_show.csv` rows, `watches` = v2 rows whose `key` starts with `watch-episode`.
  - `mergeByTvmaze(resolved: Array<{ tvTime: TvTimeShow, tvmazeId: number }>) -> Array<{ tvmazeId, stopped, addedAt, watches }>`
  - `matchEpisodes(watches, episodeRows) -> { matched: Array<{ episodeId, watchedAt }>, unmatched: Array<{ season, number }> }`
  - `seedSql(entries: Array<{ show, episodes, stopped, addedAt, watched }>) -> string`

Rules, from the spec section "TV Time import":
- Show set = union of `userSeries[].s_id`, `followed[].tv_show_id`, `watches[].s_id`. Name = first non-empty of `userSeries.series_name`, `followed.tv_show_name`, `watches.series_name`, trimmed; `null` if none.
- `stopped`: if a user-series row exists, `is_archived === 'true' || is_followed === 'false'`; otherwise if a followed row exists, `archived === '1' || active === '0'`; otherwise `true`.
- `watches`: skip rows with `is_special === 'true'`; season and number come from `season_number` and `episode_number` as numbers; `watchedAt` = `created_at`.
- `addedAt` = earliest `created_at` across all of the show's rows.
- Merge: `stopped` comes from the record with `hasUserSeries` (if none has it: stopped only if every record is stopped). `addedAt` = min. `watches` = union deduplicated on (season, number), keeping the earliest `watchedAt`.
- `seedSql` starts with `DELETE FROM watched; DELETE FROM episodes; DELETE FROM shows;` so re-running replaces everything. Then it emits one `INSERT` per row. It has no `BEGIN`/`COMMIT` (remote D1 rejects them in files). Strings are quoted with `'` doubled, and null becomes `NULL`.

- [ ] **Step 1: Write failing tests:**
  - `collectTvTimeShows`: a show only in `followed` with `archived: '1'` → stopped; a user-series row with `is_followed: 'false'` → stopped; one with `is_archived: 'false', is_followed: 'true'` → not stopped, even if its followed row says `archived: '1'`; a show only in `watches` → stopped; name `'Harry Potter '` → `'Harry Potter'`; a watch row with `is_special: 'true'` is excluded; `addedAt` is the earliest `created_at`
  - `mergeByTvmaze`: two records with the same `tvmazeId`, where only one has `hasUserSeries` (stopped: true) → merged stopped is true; overlapping watches are deduplicated and keep the earliest date
  - `matchEpisodes`: S1E1 and S9E9 against episodes containing only S1E1 → 1 matched with its episode id, 1 unmatched `{ season: 9, number: 9 }`
  - `seedSql`: the output starts with the three DELETEs; a show named `Inside Bill's Brain` appears as `'Inside Bill''s Brain'`; a null `airdate` appears as `NULL`; it contains no `BEGIN`

- [ ] **Step 2: Run** `npx vitest run test/import-lib.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** the four functions.

- [ ] **Step 4: Run** `npm test`. Expected: all tests PASS.

- [ ] **Step 5: Commit** `"Add TV Time import logic"`.

---

### Task 5: Import CLI, real import and README

**Files:**
- Create: `scripts/import.mjs`, `README.md`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `tvmazeGet`, `toShowRow`, `toEpisodeRows` (Task 3); everything from Task 4.
- Produces: `data/seed.sql`, `data/import-report.txt`; npm scripts `import` = `node scripts/import.mjs data/gdpr` and `db:seed` = `wrangler d1 execute tvtime --local --file=data/seed.sql`.

- [ ] **Step 1: Extract the export.** `mkdir -p data/gdpr && unzip -o gdpr-data.zip -d data/gdpr`.

- [ ] **Step 2: Write `scripts/import.mjs`.** It reads the folder given as argument, parses `tracking-prod-records-v2.csv` and `followed_tv_show.csv` with `csv-parse/sync` (`columns: true`), and splits the v2 rows by `key` prefix. For each TV Time show: try `/lookup/shows?thetvdb=<id>` (fetch follows the redirect), and if it returns null and a name exists, try `/singlesearch/shows?q=<name>`. Record the outcome (`by id` / `by name → <TVmaze name>` / skipped). Merge, then fetch `/shows/<tvmazeId>?embed=episodes` once per TVmaze id, match episodes, and write both files. The plain text report has three sections: shows resolved by name (TV Time name → TVmaze name and id), skipped shows (TV Time id and name), and unmatched episodes per show, followed by one line per show with its matched episode count. Wait 550 ms between TVmaze calls, which stays under 20 calls per 10 s. Log progress per show to stdout.

- [ ] **Step 3: Run it.** `npm run import`, which takes a few minutes. Expected: about 105 shows resolved. The report lists the shows matched by name (at least the old Prison Break id 75340) and the skipped ones (likely id 349078, which has no name).

- [ ] **Step 4: Show the report to the user.** Print the "matched by name", "skipped" and "unmatched episodes" sections, and ask them to confirm that no name match points to the wrong show. If one does, stop and agree on a fix with them before going on.

- [ ] **Step 5: Load the seed.** `npm run db:seed`, then `npx wrangler d1 execute tvtime --local --command "SELECT COUNT(*) FROM shows; SELECT COUNT(*) FROM watched;"`. Expected: about 105 shows and a watched count close to 1981 minus unmatched episodes minus duplicates.

- [ ] **Step 6: README.** Keep it short, with three sections:
  - Local setup: `npm install`, `npm run db:migrate`, extract the export, `npm run import`, `npm run db:seed`, `npm run dev`.
  - Testing the cron locally: `curl "localhost:8787/cdn-cgi/local/scheduled"`.
  - Going online later: `npx wrangler login`, `npx wrangler d1 create tvtime` and put the id in `wrangler.jsonc`, `npx wrangler d1 migrations apply tvtime --remote`, `npx wrangler d1 execute tvtime --remote --file=data/seed.sql`, `npx wrangler deploy`. Add a warning that the app has no authentication yet, so it needs protection (for example Cloudflare Access) before it goes online.

- [ ] **Step 7: Commit** `"Add TV Time import script and README"` (check that `data/` is not staged).

---

### Task 6: API

**Files:**
- Create: `src/db.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `isAired`, `categorize` (Task 2); `tvmazeGet`, `toShowRow`, `toEpisodeRows` (Task 3).
- Produces:
  - `upsertShowStatements(db, showRow, episodeRows) -> D1PreparedStatement[]`: insert the show or, if it exists, update only `name, status, image_url, premiered_year, tvmaze_updated` (keeping `stopped` and `added_at`); same upsert for each episode. New shows get `stopped = 0` and `added_at = new Date().toISOString()`.
  - The HTTP API below, all JSON. Errors are `{ "error": "<message>" }` with 400 for an invalid body, 404 for an unknown show, 409 for a duplicate.

| Route | Behavior |
|---|---|
| `GET /api/shows` | `[{ id, name, status, image_url, premiered_year, stopped, seen, aired, category }]`. One SQL query with `shows LEFT JOIN episodes LEFT JOIN watched GROUP BY shows.id`, computing `seen`, `aired` and `airedUnseen` with `COALESCE(..., 0)` (a show without episodes gives zeros, not nulls). `category` comes from `categorize`. |
| `GET /api/shows/:id` | `{ id, name, status, image_url, premiered_year, stopped, today, episodes: [{ id, season, number, name, airdate, watched: boolean }] }`, sorted by season then number |
| `POST /api/shows` `{ tvmazeId }` | 409 if already stored; `tvmazeGet('/shows/<id>?embed=episodes')`; 404 if null; then `db.batch(upsertShowStatements(...))`; 201 with the same shape as one `GET /api/shows` item |
| `PATCH /api/shows/:id` `{ stopped: boolean }` | updates `stopped`, 404 if unknown, returns `{ ok: true }` |
| `DELETE /api/shows/:id` | in one batch, deletes the show's `watched` rows, its episodes and the show; returns `{ ok: true }` |
| `POST /api/watched` `{ episodeIds: number[], watched: boolean }` | `true`: `INSERT OR IGNORE INTO watched (episode_id, watched_at) SELECT id, ?2 FROM episodes WHERE id IN (SELECT value FROM json_each(?1)) AND airdate IS NOT NULL AND airdate <= ?3`; `false`: delete the matching rows; returns `{ ok: true }` |

- [ ] **Step 1: Implement** `src/db.js` and the routes in `src/worker.js` (a small hand-written router on `request.method` and `URL.pathname`).

- [ ] **Step 2: Verify with the seeded database** (`npm run dev` running):
  - `curl -s localhost:8787/api/shows` returns about 105 items, and every category key appears at least once. Breaking Bad is `ended`, The Bear is `stopped`.
  - `curl -s localhost:8787/api/shows/<Breaking Bad id>` returns 62 episodes, all with `watched: true`.
  - Get one unwatched aired episode and one unaired episode (`SELECT id FROM episodes WHERE airdate > date('now') LIMIT 1`, and the same with `airdate <= date('now') AND id NOT IN (SELECT episode_id FROM watched)`). `POST /api/watched` with both ids ticks only the aired one (check with `GET /api/shows/:id`), then untick it.
  - Run `POST /api/shows {"tvmazeId": 1}` twice: the first returns 201, the second 409. Then `DELETE /api/shows/1` returns `{ ok: true }`, and a later `GET /api/shows/1` returns 404.
  - `PATCH` The Bear with `{"stopped": false}`: it becomes `ended` or `waiting` in `GET /api/shows`. Patch it back to `true`.

- [ ] **Step 3: Commit** `"Add JSON API"`.

---

### Task 7: Daily refresh cron

**Files:**
- Create: `src/refresh.js`, `test/refresh.test.js`
- Modify: `src/worker.js` (add `scheduled`)

**Interfaces:**
- Consumes: `tvmazeGet`, `toShowRow`, `toEpisodeRows` (Task 3); `upsertShowStatements` (Task 6).
- Produces:
  - `pickShowsToRefresh(myShows: Array<{ id, tvmaze_updated }>, updates: Record<string, number>, limit = 40) -> number[]`: ids whose `updates[id]` is greater than `tvmaze_updated`, oldest `tvmaze_updated` first, at most `limit`.
  - `refresh(env) -> Promise<{ refreshed: number }>`: one `tvmazeGet('/updates/shows?since=week')`, one `SELECT id, tvmaze_updated FROM shows`, one `tvmazeGet` per picked id, then a single `env.DB.batch(...)` with all upsert statements.
  - `scheduled(controller, env, ctx)` in the Worker calls `ctx.waitUntil(refresh(env))`.

- [ ] **Step 1: Write failing tests:** shows `[{ id: 1, tvmaze_updated: 100 }, { id: 2, tvmaze_updated: 50 }, { id: 3, tvmaze_updated: 10 }]` with updates `{ '1': 100, '2': 60, '3': 20, '99': 500 }` → `[3, 2]`, so equal timestamps and unknown ids are ignored. With `limit = 1` → `[3]`.

- [ ] **Step 2: Run** `npx vitest run test/refresh.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement** `pickShowsToRefresh`, `refresh` and the `scheduled` handler.

- [ ] **Step 4: Run** `npm test`. Expected: all tests PASS.

- [ ] **Step 5: Verify locally.** Set one show's `tvmaze_updated` to 0 (`wrangler d1 execute ... --local --command "UPDATE shows SET tvmaze_updated = 0 WHERE id = <a Running show>"`), then `curl "localhost:8787/cdn-cgi/local/scheduled"`. Expected: the handler succeeds, and that show's `tvmaze_updated` is back to a real timestamp.

- [ ] **Step 6: Commit** `"Add daily refresh cron"`.

---

### Task 8: Home screen

**Files:**
- Modify: `public/index.html`
- Create: `public/style.css`, `public/app.js`

**Interfaces:**
- Consumes: `GET /api/shows` (Task 6).
- Produces: a hash router in `app.js` with routes `#/` (= `in_progress` tab), `#/tab/<categoryKey>`, `#/show/<id>`, `#/add`, re-rendering a single `<main>` on `hashchange`; a shared `api(path, options)` helper that throws on a non-OK response.

- [ ] **Step 1: Implement** the page shell (viewport meta, footer per the Copy table), the router, and the home screen: tabs with counts, a row per show (poster about 60 px wide, name, progress), sorted by name, `Rien ici.` for an empty tab, and an `Ajouter une série` button linking to `#/add`. Design it mobile first, with a sober look and system fonts.

- [ ] **Step 2: Verify** in a browser at a 375 px width and on desktop: the counts add up to the total from `GET /api/shows`, switching tabs updates the hash, the back button returns to the previous tab, and tapping a row goes to `#/show/<id>`.

- [ ] **Step 3: Commit** `"Add home screen"`.

---

### Task 9: Show page

**Files:**
- Modify: `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `GET /api/shows/:id`, `POST /api/watched`, `PATCH /api/shows/:id`, `DELETE /api/shows/:id` (Task 6); `isAired` logic re-implemented inline in the front end (the same string comparison against `today` from the response).

- [ ] **Step 1: Implement** the show page following the spec's "Show page" section and the Copy table: header (poster, name, French status, progress), `J'arrête`/`Reprendre` toggle, `Retirer de ma liste` with `confirm()` that goes back to `#/` after deletion. Seasons are `<details>` elements, and the first season with an aired unseen episode is open. Each episode is a row (number, name, date); tapping an aired episode toggles it through `POST /api/watched` and updates the counts. Unaired episodes are greyed out and inert. `Tout marquer vu` sends the season's aired, unseen episode ids in one call. The button only appears when there are any.

- [ ] **Step 2: Verify** in the browser: ticking and unticking survives a reload; `Tout marquer vu` on a season with future episodes leaves those unticked; `J'arrête` moves the show to the `Arrêtées` tab and `Reprendre` moves it back; removing a show takes it out of the list.

- [ ] **Step 3: Commit** `"Add show page"`.

---

### Task 10: Add screen

**Files:**
- Modify: `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: TVmaze `GET https://api.tvmaze.com/search/shows?q=<query>` called from the browser (array of `{ show }`); `GET /api/shows` to know which ids are already stored; `POST /api/shows` (Task 6).

- [ ] **Step 1: Implement** the add screen: a search input (search on submit, no live search), results with poster, name and premiere year, and an `Ajouter` button, or the `Déjà dans ta liste` label for stored ids. After a successful add, navigate to `#/tab/watch_later`. A 409 also shows `Déjà dans ta liste`.

- [ ] **Step 2: Verify** in the browser: search `Severance` and it's labeled `Déjà dans ta liste`; search a show not in the list, add it, and it appears under `À regarder plus tard` with `0 / n épisodes`, and its page lists its episodes.

- [ ] **Step 3: Run** `npm test` one last time. Expected: all PASS.

- [ ] **Step 4: Commit** `"Add search and add screen"`.
