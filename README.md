# Maxdom

A small tracker for the TV series I watch and the Chroniques d'Aquilon comics I read, open to friends who want their own list. My series list started from my TV Time history. It runs on Cloudflare Workers and D1, with show data from [TVmaze](https://www.tvmaze.com).

Requires Node 22 or later.

## Running it locally

```sh
npm install
echo "DEV_EMAIL=you@example.com" > .dev.vars
npm run dev         # http://localhost:8787
```

There is no Cloudflare Access in local development, so the Worker takes the account from `DEV_EMAIL` in `.dev.vars` (ignored by git). Use `max.henrotin@gmail.com` to see my list. Never set `DEV_EMAIL` in `wrangler.jsonc` or in the Cloudflare dashboard: it turns the login check off.

Since the app went online (https://maxdom.maxhenrotin.workers.dev), the online D1 database is the reference. The local one, which wrangler keeps under `.wrangler/state/` (ignored by git), is a copy of it from the day of the deploy, used for development only. To work on fresh data, restore a `npm run db:backup` file into it (see below).

## Accounts

Anyone who gets through Cloudflare Access has an account, created on their first visit and identified by the email they logged in with. The shows, episodes and Aquilon volumes are shared, so a show two people follow is stored and refreshed once. Following a show, ticking episodes and reading volumes belong to each account, and nobody sees anyone else's list.

The migration that added accounts (`0004_users.sql`) gave everything already in the database to `max.henrotin@gmail.com`.

## Backing up and restoring

Export the whole database, every account included (schema, migration history and data), to a SQL file:

```sh
npx wrangler d1 export maxdom --local --output=data/backup-YYYY-MM-DD.sql   # local database
npm run db:backup                                                          # online database, into data/backup-<date>-<time>.sql
```

To restore one into an empty database, for example on a new machine, run the file as is. Don't run `npm run db:migrate` before: the export already creates the tables.

```sh
npx wrangler d1 execute maxdom --local --file=data/backup-YYYY-MM-DD.sql
```

The "Télécharger mes données" button on the Profil page is different: it only holds the logged-in account, with the shows it follows, their episodes and the Aquilon volumes. It is made of `INSERT OR IGNORE` statements, so it restores the same way into a Maxdom database that already has its tables and other accounts, without touching them.

`data/` is ignored by git because it holds personal data, so keep a copy of the backups somewhere else too.

## Testing the cron locally

Wrangler never runs the daily refresh on its own in local development. With `npm run dev` running, trigger it by hand:

```sh
curl "localhost:8787/cdn-cgi/local/scheduled"
```

Each run only looks at the shows TVmaze changed in the past week, and refreshes at most 10 of them.

A second cron reads the Chroniques d'Aquilon catalogue from monde-aquilon.com once a week, on Monday morning, and adds or updates the volumes of the "Aquilon" part. It never deletes one. To run it by hand, pass its schedule:

```sh
curl "localhost:8787/cdn-cgi/local/scheduled?cron=0+6+*+*+1"
```

## The TV Time import

The list was created once from my TV Time GDPR export by a script that has since been deleted, along with the export and the generated seed (the script is in the git history, under `scripts/`). The local database, with the corrections I made by hand afterwards, is the only reference.

## Deploying

The app was first deployed like this. The remote database is filled from an export of the local one. The export already contains the schema and the migration history, so there is no `migrations apply` step.

```sh
npx wrangler login
npx wrangler d1 create maxdom        # put the printed database_id in wrangler.jsonc
npx wrangler d1 export maxdom --local --output=data/backup-YYYY-MM-DD.sql
npx wrangler d1 execute maxdom --remote --file=data/backup-YYYY-MM-DD.sql
npx wrangler deploy
```

Then put the Worker behind Cloudflare Access, from the Worker's Access tab in the Cloudflare dashboard (the first time, it asks to set up a Zero Trust organization on the free plan). The rest is done in the Zero Trust dashboard (one.dash.cloudflare.com): add One-time PIN under Integrations > Identity providers, and in Access > Applications give the Worker's application a policy that allows everyone, so friends can get in with just their email. Copy the team domain (`https://<team>.cloudflareaccess.com`) and the application's audience (AUD) tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`, then deploy again. Until both are set, the Worker refuses every API request. Renaming the application keeps its AUD tag; deleting and recreating it doesn't.

After a code change, `npx wrangler deploy` puts it online. A new migration has to be applied to the online database first, with `npx wrangler d1 migrations apply maxdom --remote`, after a `npm run db:backup`.

The Worker checks the token Access adds to each request (`Cf-Access-Jwt-Assertion`) rather than using `ctx.access`, because Cloudflare doesn't pass `ctx.access` to a Worker that serves static assets.
