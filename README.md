# Protective Intel Watch v2

A protective intelligence dashboard for enterprise security teams: aggregates publicly
available news, categorizes it into threat types (executive threats, facility threats,
travel risk, civil unrest, terrorism, cyber, crime, kidnapping, natural disaster, supply
chain, corporate reputation, political instability, geopolitical events), scores severity,
geotags it, and displays it as a live feed, an interactive map, analytics, and a daily brief.

**This is not a news reader.** It's built around one hard architectural rule:

> The browser only ever reads `data/latest.json`. It never fetches RSS directly.

RSS collection, deduplication, categorization, and BLUF generation all happen **server-side**
in a GitHub Actions workflow that runs every 10 minutes. That workflow writes the result to
`data/latest.json`, commits it, and GitHub Pages serves the updated static site. This is what
makes the whole thing deployable with zero backend and zero database, and it's also what
avoids the CORS/rate-limit problems you get when a browser hits a public API directly.

## Architecture

```
index.html                 <- app shell, all views, references modular CSS/JS
css/                        <- one file per concern (variables, layout, components, feed, map, charts, modals, themes)
js/
  main.js                   <- entry point, wires modules together
  state.js                  <- single store: events, filters, settings, notifications
  api.js                    <- reads data/latest.json (articles only — never RSS, never Supabase)
  supabaseConfig.js         <- your Supabase project URL + anon key (safe to commit — see below)
  supabaseClient.js         <- Supabase client, loaded via ESM CDN, no bundler needed
  router.js                 <- switches between views
  modules/                  <- one file per dashboard module (feed, map, analytics, feedManager, etc.)
  utils/                    <- dom, time, storage, OPML helpers
scripts/                    <- the pipeline, run by GitHub Actions (Node, not browser code)
  fetch-feeds.mjs           <- step 1: reads the active feed list from Supabase, then pulls each RSS/Atom feed
  dedupe.mjs                <- step 2: cluster near-duplicate stories across outlets
  categorize.mjs            <- step 3: classify, score severity, geotag, generate BLUF
  build.mjs                 <- orchestrates the three steps and writes data/latest.json
  seed-supabase.mjs         <- one-time helper: pushes config/feeds.json's starter list into Supabase
config/
  feeds.json                <- ONE-TIME starter list only (see seed-supabase.mjs) — not read live anymore
  categories.json            <- category keyword sets + severity/positive-noise keyword lists
  countries.json              <- country name -> map coordinates lookup
data/
  latest.json               <- generated output the dashboard reads (seeded with sample data)
  meta.json                 <- pipeline run stats + per-feed health, used by Feed Manager
supabase/
  schema.sql                <- feeds table, admin allowlist, and RLS policies — run this first
.github/workflows/pipeline.yml <- the scheduled Action: read feeds from Supabase -> fetch -> build -> commit -> deploy
```

### Where feed configuration actually lives now

**Supabase, not a file.** The `feeds` table in your Supabase project is the single live
source of truth. The Feed Manager UI reads/writes it directly and changes apply immediately
— no commit, no redeploy. The GitHub Actions pipeline reads the same table (via Supabase's
REST API, public anon key, read-only) on every 10-minute run, so new/edited/disabled feeds
take effect on the very next run.

`config/feeds.json` still exists, but only as a one-time starter list consumed by
`scripts/seed-supabase.mjs` during initial setup. After that, editing it does nothing.

## Setting up Supabase (do this once)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste the contents of `supabase/schema.sql` → Run.
   This creates the `feeds` table, the `admins` allowlist table, and the RLS policies that
   are the actual security boundary (public read, admin-only write).
3. Add your team as admins — in the SQL Editor:
   ```sql
   insert into public.admins (email) values ('you@yourcompany.com'), ('teammate@yourcompany.com');
   ```
4. **Project Settings → API** → copy your **Project URL** and **anon public key** into
   `js/supabaseConfig.js`. This key is *designed* to be public — do not put your
   `service_role` key here or anywhere in frontend code; RLS is what keeps this safe, not
   secrecy of the anon key.
5. (Recommended) **Authentication → Providers → Email** → turn off "Allow new users to
   sign up" once your admins table is populated. Combined with the admins-table check in the
   RLS policies, this means only your allowlisted teammates can ever get in *and* only they
   can write, even if someone else's magic link somehow got sent.
6. Seed the starter feed list (either works):
   - Run the SQL Editor equivalent of `config/feeds.json`'s contents as `insert` statements, or
   - `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-supabase.mjs` (uses your
     service_role key locally only, for this one-off seed — never commit that key).
7. In your GitHub repo: **Settings → Secrets and variables → Actions → Variables** tab, add
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` as repository variables (not secrets — the anon key
   is public by design, but repo *variables* vs *secrets* both work; variables are visible in
   workflow logs which is fine here since this key is meant to be public anyway).

Once that's done, the pipeline pulls its feed list from Supabase every run, and the Feed
Manager UI's add/edit/enable/disable/delete all persist immediately for every visitor —
no git commits involved for feed management at all.

## Running the pipeline locally

```bash
npm install
SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=your-anon-key npm run build
```

This regenerates `data/latest.json` and `data/meta.json` from whatever feeds are currently
enabled in Supabase. Open `index.html` (any static file server works, e.g. `npx serve .`) to
see the result.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Repo **Settings → Actions → General → Workflow permissions → Read and write permissions**
   (the pipeline commits `data/latest.json` back to the repo, so it needs write access).
4. That's it. The `Intelligence Pipeline` workflow runs every 10 minutes, and also on every
   push to `main` that touches `config/` or `scripts/`. You can also trigger it manually from
   the **Actions** tab (`workflow_dispatch`).

The site ships with `data/latest.json` pre-populated with **clearly labeled synthetic sample
data** (titles prefixed `[SAMPLE]`, sources pointing at `*.example` domains) so the dashboard
is fully functional the moment it's deployed, even before the first real pipeline run. A
banner in the UI says so explicitly and disappears once real data lands.

## Adding feeds

The starter list in `config/feeds.json` covers a solid, real, currently-active set of outlets
across India, the UK, the US, and international wires — architected to scale to hundreds, not
pre-loaded with hundreds untested. Once seeded into Supabase (see setup above), it's no longer
where feeds live day-to-day:

- **From the UI (the normal path now):** open **Feed Manager**, sign in with an allowlisted
  admin email (magic link), then Add / Edit / Enable-Disable / Delete. Changes write straight
  to Supabase and apply immediately — no commit, no redeploy, no waiting on CI. Anyone
  (including non-admins) can still *view* the feed list and its health; only admins get the
  write controls.
- **Import OPML:** also writes straight to Supabase (upserts by feed id), for bulk-adding.
- **Directly in Supabase:** the SQL Editor or Table Editor in your Supabase dashboard work
  too, if you'd rather manage feeds that way for some reason.

General news feeds (not security-specific) work fine — every article is auto-classified
against the category keyword sets in `config/categories.json`, and anything that doesn't
match a category is silently dropped, so pointing this at a broad national outlet won't flood
the feed with irrelevant stories.

## On the "no backend" tradeoff

This version deliberately introduces Supabase as a real (hosted, managed) backend, per your
requirement that Feed Manager persist immediately without git commits. That's a genuine
architectural shift from "fully static, zero backend" to "static site + managed
backend-as-a-service for one specific piece of state (feed config)." Everything else —
article data, the dashboard itself, hosting — is still 100% static JSON + GitHub Pages. If a
literal zero-backend constraint matters again later, the previous commit-to-`config/feeds.json`
approach is preserved in git history and can be restored by reverting `js/modules/feedManager.js`,
`scripts/fetch-feeds.mjs`, and the workflow file.

## Cloudflare notes

Cloudflare Pages/Workers weren't needed for this iteration since Supabase already solves the
"persist immediately" requirement end-to-end (Postgres + auto-generated REST API + Auth, all
managed). If you still want to move dashboard *hosting* to Cloudflare Pages instead of GitHub
Pages later, that's a drop-in swap — it's still just static files, Cloudflare Pages can build
from the same repo, and nothing in the app needs to change since it doesn't care where the
static files are served from.

## What's a heuristic, not a guarantee

- **Categorization and severity** are keyword-based, not ML/LLM-based. They're deterministic,
  auditable (you can read exactly why something got tagged HIGH), and fast — but they will
  occasionally mis-tag ambiguous headlines. Treat this as a triage aid.
- **BLUF summaries** are rule-based (first clause of the headline + a stock line naming
  category/outlet count), not AI-generated. Wiring in an LLM summarizer would need an API key
  stored as a GitHub Actions secret — straightforward to add in `scripts/categorize.mjs` if you
  want it, not included by default since this project ships with zero required API keys.
- **Map coordinates** are country-centroid level (from `config/countries.json`), not exact
  addresses — a country is detected by name-matching in the headline text, so precision is
  "which country," not "which building."

## Browser support

Uses ES6 modules, `IntersectionObserver`, `AbortController`, native `fetch`, and CSS
`color-mix()`. Works in current Chrome, Edge, Firefox, and Safari. No transpilation or bundler
is used or required — it's plain files, by design, per the project's "no framework, minimal
dependencies" requirement. The only external runtime dependencies are Leaflet and
Leaflet.markercluster (loaded via CDN for the map), and Google Fonts for typography.
