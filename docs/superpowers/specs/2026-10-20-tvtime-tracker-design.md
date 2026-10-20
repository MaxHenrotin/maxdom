# TV show tracker: design

## Why

I used TV Time to track the series I watch, then moved my data to Trakt. Trakt does too much and I can't find my way around it. I want a small app that only does what I used TV Time for: knowing where I am in each series and keeping a list of series to start.

Movies, ratings, comments, friends, stats and recommendations are all out.

## What it does

1. Shows my series sorted into five categories:
   - **En cours**: I've seen some episodes and there are aired episodes left to watch.
   - **À regarder plus tard**: I haven't seen a single episode.
   - **En attente de la suite**: I've seen every aired episode and the show is still running (or its status is anything other than ended).
   - **Terminées**: I've seen every aired episode and the show has ended.
   - **Arrêtées**: I decided to stop watching. This is a manual flag, and it wins over every rule except "À regarder plus tard": a show with no episode seen is always to watch later. A show I stopped stays here even if new seasons come out.
2. On a show's page, lists every episode by season, with the ones I've seen and the ones I haven't. Episodes that haven't aired yet are greyed out and show their air date.
3. Lets me tick or untick an episode, and mark all aired episodes of a season as seen in one tap.
4. Lets me stop a show, or resume it (which puts it back in the computed categories).
5. Lets me search for a new series and add it. A new series has no episodes seen, so it lands in "À regarder plus tard".
6. Lets me remove a show from my list (for a show added by mistake).
7. Imports my TV Time history once, from the GDPR export.

That's the whole app.

## Goals, non-goals, anti-goals

Goals:
- The home screen answers "what am I watching and what's next" at a glance.
- It works well on a phone, because once it's online I'll mostly use it there.
- The first version runs fully on my machine. Putting it online later should only take a few wrangler commands, without rewriting anything.

Non-goals for this version:
- Deployment, authentication, multiple users.
- Movies, rewatches, specials, ratings, notifications.
- Offline mode or installable PWA.

Anti-goals (it would be a failure even if it technically worked):
- Any screen that feels like Trakt: menus, filters, settings, stats.
- An import that silently drops or mismatches series. Every series or episode the import couldn't match must be listed in a report.
- My GDPR export ending up in git. It holds IP addresses, device data and tokens.

## Decided stack

- **Cloudflare Workers + D1** (SQLite). Develop with `wrangler dev`, which runs D1 locally. Deploying later means creating the remote D1 database, applying the migrations, loading the seed and running `wrangler deploy`.
- **Plain HTML, CSS and JavaScript** for the front end, served as Workers static assets. No framework and no build step.
- **The Worker** serves a small JSON API under `/api/*` and runs a cron trigger.
- **TVmaze API** (free, no key) for show metadata, episode lists and search. TVmaze data is CC BY-SA, so the footer says "Data from TVmaze" with a link.
- UI text in French, code, comments and docs in English.

## Data

Three tables:

- `shows`: TVmaze show id (primary key), name, TVmaze status (`Running`, `Ended`, `To Be Determined`, `In Development`), poster URL, premiere year, `stopped` (0/1), `added_at`, `tvmaze_updated` (the show's TVmaze `updated` timestamp at the last fetch).
- `episodes`: TVmaze episode id (primary key), show id, season, number, name, air time (`airstamp`, UTC, nullable), runtime.
- `watched`: episode id (primary key), `watched_at`.

Only regular episodes are stored. TVmaze leaves specials out of its episode list by default, and that's fine.

An episode is "aired" once its air time has passed. The Worker compares it with its own clock, so an episode becomes tickable at the hour it airs and not at the next UTC midnight. The category of each show is computed on read, never stored, following the rules in "What it does".

## TV Time import

I checked the export (`gdpr-data.zip`, 59 CSV files). The files that matter:

- `tracking-prod-records-v2.csv`: the newest data. Rows whose `key` starts with `watch-episode` are seen episodes (1981 rows, with `s_id` = TheTVDB show id, `season_number`, `episode_number`, `is_special`, `created_at`). Rows whose `key` starts with `user-series` hold per-show state (97 rows: `s_id`, `series_name`, `is_followed`, `is_archived`, `created_at`). Rows starting with `rewatch-episode` are ignored.
- `followed_tv_show.csv`: an older table of followed shows (83 rows: `tv_show_id`, `tv_show_name`, `active`, `archived`, `created_at`). Some shows only exist here (Obi-Wan Kenobi, Willow, Attack on Titan, Sense8...).
- `tracking-prod-records.csv` (v1) adds nothing beyond movies, so the import ignores it.

Rules:

1. The set of shows is the union of `s_id` from `user-series` rows, `tv_show_id` from `followed_tv_show.csv`, and `s_id` from `watch-episode` rows (one show, id 349078, only appears there and has no name).
2. **Stopped** if the show was archived or unfollowed in TV Time. When a `user-series` row exists, use it: `is_archived = true` or `is_followed = false`. Otherwise use `followed_tv_show.csv`: `archived = 1` or `active = 0`. A show with neither row counts as unfollowed, so it's stopped. I confirmed this: I archive shows I won't continue (like The Bear, fully seen but I don't want the next seasons), and unfollowed shows also go to "Arrêtées", except the ones with zero episodes seen, which stay in "À regarder plus tard".
3. Resolve each TheTVDB id to TVmaze with `GET /lookup/shows?thetvdb=<id>`. That fails for some ids (TV Time's old Prison Break id 75340 returns nothing). Then fall back to `GET /singlesearch/shows?q=<name>`. If that also fails, or there is no name, skip the show and report it.
4. Several TV Time ids can resolve to the same TVmaze show (Prison Break appears as 75340 and 360115). Merge them: union of seen episodes, and for `stopped` and `added_at`, the record that has a `user-series` row wins.
5. Match each seen episode to a TVmaze episode by (season, number). Skip rows with `is_special = true`. Report every episode that doesn't match.
6. `watched_at` comes from the row's `created_at`. `added_at` comes from the earliest `created_at` among the show's rows.
7. The report lists, for each show: how it was resolved (by id or by name, with the TVmaze name, so I can catch a wrong name match), how many episodes matched, and which didn't. It also lists the skipped shows.

The import is a Node script run once on my machine, reading the export extracted to `data/gdpr/`. It writes `data/seed.sql`, which was loaded once into the local D1, and `data/import-report.txt`. I then corrected the local database by hand (shows whose numbering differs between TV Time and TVmaze), so the local database, not `seed.sql`, is the reference from then on: the remote database is filled from an export of it. The whole `data/` folder is ignored by git. Both outputs contain personal data and stay out of git, along with the zip and the extracted folder.

TVmaze allows about 20 calls per 10 seconds. The import has to pace its calls and retry on HTTP 429. Around 110 shows means a few minutes, which is fine.

## Keeping episode lists fresh

New episodes get announced and aired, so the stored lists go stale. A Worker cron trigger runs once a day:

1. One call to `GET /updates/shows?since=week`, which returns every TVmaze show id updated in the past week with its `updated` timestamp.
2. Pick my shows whose timestamp there is newer than the `tvmaze_updated` I stored for them. On a normal day that's a handful.
3. Refresh at most 40 of them, one call each (`GET /shows/<id>?embed=episodes`), updating status, poster, `tvmaze_updated` and upserting episodes. Write everything to D1 in a single `batch()` at the end.

The cap exists because the Workers free plan allows 50 subrequests per invocation, and D1 queries count toward it. Shows over the cap get picked up the next day, since the update list covers a week. This also covers stopped and ended shows at no extra cost.

Adding a show through the app fetches the same endpoint once.

## Screens

Mobile first, and it should also look fine on a desktop browser.

**Home.** Next to the title, in small type, a recap of everything watched: total minutes (episodes without a runtime count as 0) and total episodes seen. Below, five tabs, one per category, each with its count, on a single row that never scrolls, even on a phone: an icon and the count sit above a short label. Order and labels: En cours, En attente, Terminées, Arrêtées, Pas commencées. The app opens on "En cours". Each show is a row with its poster, name and progress in episodes and minutes ("34 / 62 épisodes (1 530 / 2 790 min)", seen / aired), sorted by minutes watched (sum of the runtimes of the episodes seen), most first, then by name. The progress bar is red in "Arrêtées", mauve in "Terminées" and green elsewhere. Tapping a row opens the show's page. A button opens the add screen.

**Show page.** Poster, name, TVmaze status in French, progress. Below, the series summary fetched from TVmaze `GET /shows/<id>` in the browser, cut to four lines until tapped; the page still opens without it if TVmaze is unreachable. A "J'arrête" or "Reprendre" button, and a less prominent "Retirer de ma liste" with a confirmation. Then the seasons, collapsible, each with "x / y vus" and a "Tout marquer vu" button. Opening the page expands the first season that has an aired episode I haven't seen. Each episode shows its number, name and air date. Tapping its circle toggles it as seen. Tapping the rest of the row opens a short panel fetched from TVmaze `GET /episodes/<id>` in the browser: still image, runtime, TVmaze rating, summary (in English, TVmaze has no French) and, if seen, the date I ticked it ("Vu le …"). Unaired episodes are greyed out and can't be ticked. The progress bar takes the category colour, as on the home screen.

**Add screen.** A search field. Results come from TVmaze `GET /search/shows?q=`, called straight from the browser (TVmaze allows CORS), and show poster, name and premiere year. Shows already in my list are labeled as such. Tapping "Ajouter" adds the show and goes back home on the "À regarder plus tard" tab.

Navigation uses the URL hash (`#/`, `#/show/<id>`, `#/add`), so the back button works. The show page and the add screen also have a "‹ Retour" link: it goes back in history, or home when the page was opened directly.

## API

All JSON, under `/api`:

- `GET /api/shows`: every show with its category, seen count, aired count and poster.
- `GET /api/shows/:id`: one show with all its episodes, each with a `watched` flag.
- `POST /api/shows` `{ "tvmazeId": 123 }`: fetches the show from TVmaze and stores it with its episodes.
- `PATCH /api/shows/:id` `{ "stopped": true }`
- `DELETE /api/shows/:id`: removes the show, its episodes and its watched rows.
- `POST /api/watched` `{ "episodeIds": [..], "watched": true }`: ticks or unticks one or more episodes (used for single episodes and whole seasons).

## Testing

The category rules and the import's matching and merging logic are pure functions with unit tests (Vitest). The API and the screens get checked by hand against `wrangler dev`, after loading the real import.

## Left to the builder

- Visual style, as long as it stays sober and readable on a phone.
- File layout, SQL details, indexes, error messages.
- How the import script is split into modules, and which small CSV parsing dependency it uses (series names contain commas, so splitting on commas won't work).
- The exact way to trigger the cron locally for testing.
