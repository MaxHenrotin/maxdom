# Multiple accounts: design

## Why

I want to put Maxdom online, and I'd like my friends to use it too. When a friend opens it, it's because I told them about it, and they'll use it for their own series and books the way I do. Each person stays in their own bubble: nobody sees anyone else's list.

This has to be done before the first deploy. If the app goes online single-user, the remote database has to be reshaped afterwards, and the local database is still the only copy of my hand-corrected list. Reshaping it locally once and deploying the result is safer.

## What it does

1. Anyone with the link can get in. They type their email, receive a one-time code from Cloudflare Access, and they're in. There is no password and no sign-up page in the app.
2. The first visit creates the account. A new account starts with an empty series list and nothing read in Aquilon.
3. Every account sees both parts, Séries and Aquilon.
4. The Profil page shows the account's email and a button that downloads that account's data only.
5. My existing data becomes my account's data (max.henrotin@gmail.com).

## Goals, non-goals, anti-goals

Goals:
- A friend goes from the link to an empty list they can fill in a minute, without me doing anything.
- Nothing about my own use changes, apart from logging in.

Non-goals:
- Anything social: following friends, sharing a list, comparing progress.
- Invitations or an allowlist. Access is open to everyone (the user's choice). Closing it later is a policy change in Cloudflare, not a code change.
- Account deletion, email change, admin pages.
- Importing a friend's history from TV Time or anywhere else.

Anti-goals:
- One account seeing or changing another account's data, through the UI, the API or the export.
- Writing our own authentication (passwords, sessions, reset emails).

## Authentication

Cloudflare Access sits in front of the whole Worker, with a one-time PIN login and a policy that lets everyone in. On every request it adds a signed JWT in the `Cf-Access-Jwt-Assertion` header. The Worker verifies it (RS256, keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, the `aud` must match the Access application's tag, `exp` must be in the future) and takes the `email` claim, lowercased, as the identity (lowercasing is my call). A request without a valid token gets a 401. The front end doesn't handle that case: behind Access it only happens to someone bypassing it. The team domain and the audience tag are plain `vars` in `wrangler.jsonc`; they aren't secrets.

The check uses Web Crypto, with no new dependency (my call). The keys can be cached in module scope between requests.

Access blocks everything at the edge, static files included. Only `/api/*` reaches the Worker code (`run_worker_first`), so that's where the JWT check runs. The static files hold no personal data.

Local development has no Access. When `DEV_EMAIL` is set, the Worker uses it as the identity and skips the JWT. It is set in `.dev.vars`, which wrangler reads in `npm run dev` and never deploys; `.dev.vars` goes in `.gitignore` and the README says how to create it. It must never be set in `wrangler.jsonc` or in the Cloudflare dashboard, since that would turn the check off in production.

Before deploying, check that Access can be put in front of a `workers.dev` URL. If it can't, the app needs a custom domain. This is a deploy-time question and doesn't change the code.

## Data

A new migration, `0004_users.sql`:

- `users`: `id` (integer primary key), `email` (unique, not null), `created_at`.
- `user_shows`: `user_id`, `show_id`, `stopped`, `added_at`, primary key `(user_id, show_id)`. `stopped` and `added_at` move here from `shows`.
- `watched` gets a `user_id`; its primary key becomes `(user_id, episode_id)`.
- `books_read` gets a `user_id`; its primary key becomes `(user_id, book_id)`.

`shows`, `episodes` and `books` stay shared: they hold what comes from TVmaze and monde-aquilon.com. If two people follow the same show, it is stored and refreshed once.

The migration creates user 1 with my email and attaches every existing show, watched episode and read volume to it. SQLite can't add a column to a primary key, so `watched` and `books_read` are rebuilt (create, copy, drop, rename), then `stopped` and `added_at` are dropped from `shows`. D1 enforces foreign keys, so the migration starts with `PRAGMA defer_foreign_keys = true`. The email ends up in the migration file, in a private repo (my call; it's already in every commit). On a fresh database (tests) the migration still creates that user with no data, which is harmless.

`upsertShowStatements` no longer writes `stopped` or `added_at`; following a show inserts the `user_shows` row.

The account row is created on the first request from a new email (`INSERT ... ON CONFLICT (email) DO UPDATE ... RETURNING id`, one statement per request).

Back up the local database before applying the migration.

## API

Every route works on the logged-in account:

- `GET /api/me`: `{ email }`, for the Profil page.
- `GET /api/shows`, `GET /api/shows/:id`: only shows the account follows; another show is a 404.
- `POST /api/shows`: follows a show. If it's already in the shared catalogue, nothing is fetched from TVmaze. 409 if the account already follows it.
- `PATCH /api/shows/:id`: sets `stopped` on the account's `user_shows` row.
- `DELETE /api/shows/:id`: removes the account's `user_shows` row and its watched rows for that show. When nobody follows the show anymore, the show and its episodes are deleted too (my call), which keeps the refresh cron working only on followed shows.
- `POST /api/watched`: only aired episodes of shows the account follows can be ticked.
- `GET /api/books`, `POST /api/books/read`: the shared catalogue, with the account's read ticks.
- `GET /api/export`: the account's data, see below.

The two crons don't change. The TVmaze refresh already reads every show in `shows`, and with orphan shows deleted that is the set of shows someone follows.

## Export and backups

The Profil button downloads a SQL file with the account's row, the shows it follows with their episodes, all books, and its own `user_shows`, `watched` and `books_read` rows, written as `INSERT OR IGNORE`. It restores into a Maxdom database whose schema already exists, without touching other accounts (my call on the format; it keeps "restore with `wrangler d1 execute`" true).

The full backup, every account included, is a new `npm run db:backup` script that runs `wrangler d1 export maxdom --remote` into `data/backup-<date>.sql`. The README keeps the local export command for development.

## Front end

The Profil page shows the email from `GET /api/me` above the download button, and the button's text says it covers this account only. A "Se déconnecter" link to `/cdn-cgi/access/logout` sits under it (my call).

Nothing else in the UI changes. A new account sees the existing empty states.

## Tests

The existing tests run with a user. New tests cover: two accounts don't see or change each other's shows, ticks and reads; following a show already in the catalogue doesn't call TVmaze; the last unfollow deletes the show; the export contains only the account's rows; the JWT check accepts a valid token and rejects a missing, expired, wrongly signed or wrong-audience one; `DEV_EMAIL` is used when set. The migration is tested on a database with existing data.

## Left to the builder

- How the identity is passed from `fetch` to the handlers.
- The exact SQL of the migration and of the export.
- How tests sign JWTs (a key pair generated in the test is enough).
