# TV show tracker

A small personal tracker for the TV series I watch, seeded from my TV Time history. It runs on Cloudflare Workers and D1, with show data from [TVmaze](https://www.tvmaze.com).

Requires Node 22 or later.

## Local setup

```sh
npm install
npm run db:migrate
mkdir -p data/gdpr && unzip -o gdpr-data.zip -d data/gdpr
npm run import      # a few minutes; writes data/seed.sql and data/import-report.txt
npm run db:seed
npm run dev         # http://localhost:8787
```

Read `data/import-report.txt` after the import. It lists the shows matched by name, the shows that were skipped and the episodes that didn't match. Everything in `data/` is personal data and stays out of git.

## Testing the cron locally

With `npm run dev` running:

```sh
curl "localhost:8787/cdn-cgi/local/scheduled"
```

## Going online later

The app has no authentication yet. Put it behind something like Cloudflare Access before deploying it, or anyone with the URL can read and edit the list.

```sh
npx wrangler login
npx wrangler d1 create tvtime        # put the printed database_id in wrangler.jsonc
npx wrangler d1 migrations apply tvtime --remote
npx wrangler d1 execute tvtime --remote --file=data/seed.sql
npx wrangler deploy
```
