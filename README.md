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

The data lives in the local D1 database that wrangler keeps under `.wrangler/state/`. That folder is ignored by git and it is the only copy of my list, including the corrections I made by hand after the import. Deleting `.wrangler/` deletes the list, so back it up first.

## Accounts

Anyone who gets through Cloudflare Access has an account, created on their first visit and identified by the email they logged in with. The shows, episodes and Aquilon volumes are shared, so a show two people follow is stored and refreshed once. Following a show, ticking episodes and reading volumes belong to each account, and nobody sees anyone else's list.

The migration that added accounts (`0004_users.sql`) gave everything already in the database to `max.henrotin@gmail.com`.

## Backing up and restoring

Export the whole database, every account included (schema, migration history and data), to a SQL file:

```sh
npx wrangler d1 export maxdom --local --output=data/backup-YYYY-MM-DD.sql   # local database
npm run db:backup                                                          # online database, into data/backup-<today>.sql
```

To restore one into an empty database, for example on a new machine, run the file as is. Don't run `npm run db:migrate` before: the export already creates the tables.

```sh
npx wrangler d1 execute maxdom --local --file=data/backup-YYYY-MM-DD.sql
```

The "Télécharger mes données" button on the Profil page is different: it only holds the logged-in account, with the shows it follows and their episodes. It is made of `INSERT OR IGNORE` statements, so it restores the same way into a Maxdom database that already has its tables and other accounts, without touching them.

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

## Going online later

The remote database is filled from an export of the local one. The export already contains the schema and the migration history, so there is no `migrations apply` step.

```sh
npx wrangler login
npx wrangler d1 create maxdom        # put the printed database_id in wrangler.jsonc
npx wrangler d1 export maxdom --local --output=data/backup-YYYY-MM-DD.sql
npx wrangler d1 execute maxdom --remote --file=data/backup-YYYY-MM-DD.sql
npx wrangler deploy
```

Then put the Worker behind Cloudflare Access. In the dashboard, under the Worker's Settings > Domains & Routes, enable Cloudflare Access on the `workers.dev` URL. Give the Access application the One-time PIN login and a policy that allows everyone, so friends can get in with just their email. The setup shows the team domain (`https://<team>.cloudflareaccess.com`) and the application's audience tag: copy them into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`, then deploy again. Until both are set, the Worker refuses every API request.

The Worker checks the token Access adds to each request (`Cf-Access-Jwt-Assertion`) rather than using `ctx.access`, because Cloudflare doesn't pass `ctx.access` to a Worker that serves static assets.
