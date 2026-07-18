// Orchestrates the full pipeline: fetch RSS -> dedupe -> categorize -> merge into
// the permanent Supabase archive -> write JSON. This is what GitHub Actions runs
// on a schedule. The browser never touches RSS directly.
//
// Storage model: every story ever classified is upserted into the Supabase
// "articles" table and kept for 90 days (see supabase/create_articles_table.sql).
// Anything older than that is permanently deleted each run. data/latest.json
// is rebuilt from the FULL archive each run, not just the current RSS fetch -
// so a story that later rotates out of a publisher's own RSS feed stays
// visible on the site (until it ages past 90 days) instead of disappearing
// the moment the source feed moves on.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchAllFeeds } from "./fetch-feeds.mjs";
import { dedupeArticles } from "./dedupe.mjs";
import { categorizeClusters } from "./categorize.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const CATEGORIES_PATH = new URL("../config/categories.json", import.meta.url);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Keep 3 months of history, then permanently delete anything older - this
// keeps the archive from growing forever while still giving a much longer
// window than the old 7-day cutoff.
const RETENTION_DAYS = 90;

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

/** Converts a categorized event (camelCase, as produced by categorize.mjs)
 *  into the snake_case row shape the Supabase "articles" table expects. */
function eventToRow(event, existingFirstSeenAt, nowIso) {
  return {
    id: event.id,
    title: event.title,
    bluf: event.bluf,
    category: event.category,
    category_label: event.categoryLabel,
    category_color: event.categoryColor,
    severity: event.severity,
    country: event.country,
    lat: event.lat,
    lon: event.lon,
    published_at: event.publishedAt,
    source_count: event.sourceCount,
    sources: event.sources,
    primary_url: event.primaryUrl,
    primary_domain: event.primaryDomain,
    has_executive_title: event.hasExecutiveTitle,
    corporate_score: event.corporateScore,
    is_corporate: event.isCorporate,
    is_likely_political: event.isLikelyPolitical,
    first_seen_at: existingFirstSeenAt || nowIso,
    last_seen_at: nowIso
  };
}

/** Converts a Supabase "articles" row (snake_case) back into the camelCase
 *  event shape the frontend already expects from data/latest.json. */
function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    bluf: row.bluf,
    category: row.category,
    categoryLabel: row.category_label,
    categoryColor: row.category_color,
    severity: row.severity,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    publishedAt: row.published_at,
    sourceCount: row.source_count,
    sources: row.sources,
    primaryUrl: row.primary_url,
    primaryDomain: row.primary_domain,
    hasExecutiveTitle: row.has_executive_title,
    corporateScore: row.corporate_score,
    isCorporate: row.is_corporate,
    isLikelyPolitical: row.is_likely_political
  };
}

/** Fetches every existing article id + first_seen_at from the archive, so
 *  upserts can preserve the original first_seen_at instead of resetting it
 *  to "now" every single run. */
async function fetchExistingFirstSeenMap() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=id,first_seen_at`, {
    headers: supabaseHeaders()
  });
  if (!res.ok) throw new Error(`Failed to read existing articles: HTTP ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const map = new Map();
  for (const r of rows) map.set(r.id, r.first_seen_at);
  return map;
}

/** Upserts this run's classified events into the permanent archive. Uses
 *  Supabase's merge-duplicates upsert (matches on the "id" primary key,
 *  which comes from dedupeArticles' cluster.id - the primary article URL). */
async function upsertArticles(events) {
  if (!events.length) return;
  const nowIso = new Date().toISOString();
  const firstSeenMap = await fetchExistingFirstSeenMap();
  const rows = events.map(e => eventToRow(e, firstSeenMap.get(e.id), nowIso));

  const CHUNK_SIZE = 200;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(chunk)
    });
    if (!res.ok) throw new Error(`Failed to upsert articles (chunk starting at ${i}): HTTP ${res.status} ${await res.text()}`);
  }
}

/** Permanently deletes any article whose published_at is older than
 *  RETENTION_DAYS. Runs before the archive is read back, so data/latest.json
 *  and the site never show anything past the retention window, and the
 *  Supabase table doesn't grow forever. */
async function pruneOldArticles() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?published_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    headers: supabaseHeaders({ Prefer: "return=minimal" })
  });
  if (!res.ok) throw new Error(`Failed to prune old articles: HTTP ${res.status} ${await res.text()}`);
}

/** Reads back the FULL permanent archive - every article stored within the
 *  retention window, not just what this run's RSS fetch returned - so the
 *  site reflects everything seen over the last 3 months. */
async function fetchFullArchive() {
  const pageSize = 1000;
  let all = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=*&order=published_at.desc&limit=${pageSize}&offset=${offset}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to read archive: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all.map(rowToEvent);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set - required for the permanent article archive.");
  }

  const startedAt = new Date().toISOString();
  console.log(`[build] starting pipeline run at ${startedAt}`);

  const { items, feedHealth } = await fetchAllFeeds();
  console.log(`[build] fetched ${items.length} raw articles across ${feedHealth.length} configured feeds`);

  const clusters = dedupeArticles(items);
  console.log(`[build] clustered into ${clusters.length} unique stories`);

  const newEvents = await categorizeClusters(clusters);
  console.log(`[build] ${newEvents.length} events classified as protective-intel relevant this run`);

  console.log(`[build] upserting ${newEvents.length} events into the permanent Supabase archive...`);
  await upsertArticles(newEvents);

  console.log(`[build] pruning articles older than ${RETENTION_DAYS} days...`);
  await pruneOldArticles();

  console.log(`[build] reading back the full permanent archive...`);
  const events = await fetchFullArchive();
  events.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  console.log(`[build] archive now holds ${events.length} events total (last ${RETENTION_DAYS} days)`);

  // Full static category list (id/label/color only, no keyword lists) so the
  // sidebar always shows every category - including ones with zero events in
  // this particular run - instead of a category silently vanishing whenever
  // no matching story happened to come through.
  const { categories } = JSON.parse(await readFile(CATEGORIES_PATH, "utf8"));
  const allCategories = categories.map(c => ({ id: c.id, label: c.label, color: c.color }));

  const finishedAt = new Date().toISOString();
  const meta = {
    generatedAt: finishedAt,
    startedAt,
    totalEventsCount: events.length,
    newEventsThisRun: newEvents.length,
    rawArticleCount: items.length,
    feedHealth,
    allCategories,
    categoriesPresent: [...new Set(events.map(e => e.category))]
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL("latest.json", DATA_DIR), JSON.stringify({ meta, events }, null, 2));
  await writeFile(new URL("meta.json", DATA_DIR), JSON.stringify(meta, null, 2));
  console.log(`[build] wrote data/latest.json (${events.length} events, full archive) and data/meta.json`);
}

main().catch(err => {
  console.error("[build] pipeline failed:", err);
  process.exit(1);
});
