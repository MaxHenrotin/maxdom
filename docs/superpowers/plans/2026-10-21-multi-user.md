# Multiple accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every API call works on the account behind the Cloudflare Access login, with a shared TVmaze/Aquilon catalogue and per-account follows, ticks and export.

**Architecture:** `src/auth.js` turns a request into an email (Access JWT, or `DEV_EMAIL` locally). `fetch` upserts the account row and passes `user = { id, email }` to every handler. Migration 0004 adds `users` and `user_shows` and puts `user_id` in `watched` and `books_read`.

**Tech Stack:** Cloudflare Workers, D1, Web Crypto, vitest with `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-21-multi-user-design.md`

## Global Constraints

- No new dependency. Node 22 (`PATH=~/.nvm/versions/node/v22.23.3/bin:$PATH`).
- UI text in French; code, comments, commit messages in English. No mention of Claude in commits. Never push.
- Owner account: id 1, `max.henrotin@gmail.com`.
- Back up the local DB before applying the migration: `npx wrangler d1 export maxdom --local --output=data/backup-2026-10-21-pre-users.sql`.
- Tests call `worker.fetch(request, { DB: db, DEV_EMAIL: '<email>' })`.

## Review Focus

- A token with an unknown `kid` (Access rotated its keys): the keys are fetched again once, then the token is checked. Test in Task 1.
- `aud` sent as a string instead of an array: still accepted. Test in Task 1.
- Ticking an episode of a show the account doesn't follow: ignored. Test in Task 2.
- One account unfollowing a show another account follows: the other keeps the show, its episodes and its ticks. Test in Task 2.
- Restoring an export into a database where the email has a different id, or where id 1 is someone else: rows land on the right account. Test in Task 3.

---

### Task 1: Identify the caller

**Files:**
- Create: `src/auth.js`, `test/auth.test.js`

**Interfaces:**
- Produces: `identify(request: Request, env: { DEV_EMAIL?, ACCESS_TEAM_DOMAIN, ACCESS_AUD }, now = Date.now()): Promise<string | null>`, the lowercased email or null.

- [ ] **Step 1: Write the failing tests** in `test/auth.test.js`. Generate an RS256 key pair with `crypto.subtle.generateKey` (kid `k1`), stub `fetch` to return `{ keys: [publicJwk with kid] }` for `https://team.cloudflareaccess.com/cdn-cgi/access/certs`, sign tokens in the test. Env: `{ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud1' }`.
  - `returns the lowercased email of a valid token` → `'Max@Example.com'` gives `'max@example.com'`
  - `accepts aud as a string or an array`
  - `rejects a missing, malformed, expired, wrongly signed or wrong-audience token` → each null
  - `fetches the keys again for an unknown kid` → token signed by a second key `k2`, certs stub now returns both, result is the email
  - `uses DEV_EMAIL without a token` → `{ DEV_EMAIL: 'dev@example.com' }` gives `'dev@example.com'`, fetch not called
- [ ] **Step 2: Run** `npx vitest run test/auth.test.js`, expect FAIL (module missing).
- [ ] **Step 3: Implement `identify`.** Header `cf-access-jwt-assertion`; verify with `RSASSA-PKCS1-v1_5`/`SHA-256` keys imported from the certs JWKs; keys cached in module scope as a `Map` by kid and refetched when the kid is missing; check `aud` includes `ACCESS_AUD`, `exp * 1000 > now`; any parse error gives null.
- [ ] **Step 4: Run** the test file, expect PASS.
- [ ] **Step 5: Commit** `Identify the caller from the Cloudflare Access token`.

### Task 2: Per-account data

**Files:**
- Create: `migrations/0004_users.sql`, `test/migration.test.js`
- Modify: `src/worker.js`, `src/db.js`, `src/books.js`
- Test: `test/worker.test.js`, `test/books.test.js`, `test/db.test.js`, `test/refresh.test.js`

**Interfaces:**
- Consumes: `identify` (Task 1).
- Produces: tables `users(id, email UNIQUE, created_at)`, `user_shows(user_id, show_id, stopped, added_at)` PK `(user_id, show_id)`, `watched(user_id, episode_id, watched_at)` PK `(user_id, episode_id)`, `books_read(user_id, book_id, read_at)` PK `(user_id, book_id)`; `shows` without `stopped`/`added_at`. Handlers take `user = { id, email }`; `listBooks(db, now, user)`, `setRead(db, now, user, body)`.

- [ ] **Step 1: Write the migration test** `test/migration.test.js`: run 0001–0003 on a `DatabaseSync`, insert a show (stopped 1), two episodes, one watched row, a book and a read row, run 0004. Expect `users` = `[{ id: 1, email: 'max.henrotin@gmail.com' }]` (plus `created_at`), `user_shows` = `[{ user_id: 1, show_id: 7, stopped: 1, added_at: 'x' }]`, watched and books_read rows with `user_id: 1`, and `shows` columns no longer include `stopped`, `added_at`.
- [ ] **Step 2: Write the API tests.** Rewrite fixtures to the new schema (`user_shows` rows, `user_id` in `watched`/`books_read`) and add, in `test/worker.test.js`:
  - `401 without an identity` → env `{ DB }` only, `GET /api/shows` status 401.
  - `creates the account on the first request` → new email, `users` has 2 rows, `GET /api/shows` is `[]`.
  - `keeps two accounts apart` → A follows 7 and ticks episode 1; B follows 7: B's `seen` is 0, B's `GET /api/shows/8` (followed by A only) is 404, B's PATCH/DELETE on 8 is 404 / leaves A's row.
  - `follows a show already in the catalogue without calling TVmaze` → fetch spy not called, status 201.
  - `409 when the account already follows the show`.
  - `ignores ticks on a show the account doesn't follow`.
  - `keeps the show for the other followers on unfollow, deletes it after the last one` → episodes and A's ticks kept after B unfollows; `shows` empty after A unfollows.
  - in `test/books.test.js`: `keeps read ticks per account`.
- [ ] **Step 3: Run** `npm test`, expect FAIL.
- [ ] **Step 4: Write `0004_users.sql`.** `PRAGMA defer_foreign_keys = true`; create `users`, insert user 1; create `user_shows` from `shows`; `ALTER TABLE shows DROP COLUMN stopped`, `... added_at`; rebuild `watched` and `books_read` (create `_new`, copy with `user_id` 1, drop, rename).
- [ ] **Step 5: Update the Worker.** In `fetch`: `identify`, 401 `error(401, 'not logged in')` when null, then `INSERT INTO users (email, created_at) VALUES (?1, ?2) ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING id`. `SUMMARY_SQL` starts from `user_shows us` joined to `shows`, with `watched` joined on `w.user_id = us.user_id`; `stopped` comes from `us`. `addShow` checks `user_shows` first (409), fetches TVmaze only when the show isn't in `shows`, and inserts the `user_shows` row in the same batch. `setStopped`, `removeShow`, `setWatched` as in the spec, `setWatched` limited to `show_id IN (SELECT show_id FROM user_shows WHERE user_id = ?)`. `upsertShowStatements` drops `stopped`/`added_at`. Books: join `books_read` on `r.user_id`.
- [ ] **Step 6: Run** `npm test`, expect PASS. The export test is rewritten in Task 3; until then, only update its fixture to the new schema.
- [ ] **Step 7: Commit** `Give every account its own list`.

### Task 3: Per-account export and Profil

**Files:**
- Modify: `src/export.js`, `src/worker.js`, `public/app.js`
- Test: `test/export.test.js`, `test/worker.test.js`

**Interfaces:**
- Produces: `exportAccount(db, user, now): Promise<Response>`; `GET /api/me` → `{ email }`.

- [ ] **Step 1: Write the failing tests.**
  - `GET /api/me gives the email`.
  - `exports only the account's rows` → accounts A and B with their own shows and ticks; A's file mentions none of B's show, episode or tick.
  - `restores into another database without touching its accounts` → target DB built with all migrations, where id 1 is the owner and `a@example.com` doesn't exist yet; run the file; A's `user_shows`, `watched`, `books_read` rows exist under A's new id, user 1's rows unchanged, filename still `sauvegarde-YYYY-MM-DD.sql`.
- [ ] **Step 2: Run** `npm test`, expect FAIL.
- [ ] **Step 3: Implement `exportAccount`.** `INSERT OR IGNORE` lines in this order: the `users` row (email, created_at, no id), followed `shows`, their `episodes`, all `books`, then `user_shows`, `watched`, `books_read` where `user_id` is written as `(SELECT id FROM users WHERE email = '<email>')`. Replace the full-dump code.
- [ ] **Step 4: Profil page.** `renderProfile` awaits `api('/me')` and shows:

  ```
  Connecté avec <email>.
  Une copie de tes séries et de tes tomes lus, au format SQL.
  [Télécharger mes données]
  Se déconnecter (link to /cdn-cgi/access/logout)
  ```
- [ ] **Step 5: Run** `npm test`, expect PASS.
- [ ] **Step 6: Commit** `Export only the logged-in account and show it on the Profil page`.

### Task 4: Config, backups and README

**Files:**
- Modify: `wrangler.jsonc`, `package.json`, `.gitignore`, `README.md`

- [ ] **Step 1:** `wrangler.jsonc` gets `"vars": { "ACCESS_TEAM_DOMAIN": "", "ACCESS_AUD": "" }` with a comment that they're filled at deploy time (empty values reject every request). `.gitignore` gets `.dev.vars`. `package.json` gets `"db:backup": "wrangler d1 export maxdom --remote --output=data/backup-$(date +%F).sql"`. Create the local `.dev.vars` with `DEV_EMAIL=max.henrotin@gmail.com`.
- [ ] **Step 2:** README: `.dev.vars` setup in "Running it locally"; backups section covers the local export, `npm run db:backup` and the per-account Profil file; "Going online later" replaces the no-auth warning with the Access setup (one-time PIN, policy "Everyone", copy the team domain and the application's AUD tag into `vars`, check Access works on `workers.dev`).
- [ ] **Step 3:** Back up the local DB (Global Constraints), run `npm run db:migrate`, start `npm run dev` and check `/api/me`, `/api/shows` (same count as before) and `/api/books` respond for the owner.
- [ ] **Step 4: Commit** `Document the login and add the remote backup script`.
