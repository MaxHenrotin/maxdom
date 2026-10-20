# TV show tracker

A small personal tracker for the TV series I watch, started from my TV Time history. It runs on Cloudflare Workers and D1, with show data from [TVmaze](https://www.tvmaze.com).

Requires Node 22 or later.

## Running it locally

```sh
npm install
npm run dev         # http://localhost:8787
```

The data lives in the local D1 database that wrangler keeps under `.wrangler/state/`. That folder is ignored by git and it is the only copy of my list, including the corrections I made by hand after the import. Deleting `.wrangler/` deletes the list, so back it up first.

## Backing up and restoring

Export the whole database (schema, migration history and data) to a SQL file:

```sh
npx wrangler d1 export tvtime --local --output=data/backup-YYYY-MM-DD.sql
```

To restore it into an empty local database, for example on a new machine, run the file as is. Don't run `npm run db:migrate` before: the export already creates the tables.

```sh
npx wrangler d1 execute tvtime --local --file=data/backup-YYYY-MM-DD.sql
```

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

The app has no authentication yet. Put it behind something like Cloudflare Access before deploying it, or anyone with the URL can read and edit the list.

The remote database is filled from an export of the local one. The export already contains the schema and the migration history, so there is no `migrations apply` step.

```sh
npx wrangler login
npx wrangler d1 create tvtime        # put the printed database_id in wrangler.jsonc
npx wrangler d1 export tvtime --local --output=data/backup-YYYY-MM-DD.sql
npx wrangler d1 execute tvtime --remote --file=data/backup-YYYY-MM-DD.sql
npx wrangler deploy
```
