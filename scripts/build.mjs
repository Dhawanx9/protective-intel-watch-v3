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
//
// CROSS-RUN DEDUPLICATION: dedupeArticles() only clusters articles fetched
// within THIS run (a single 10-minute window). Without more, the same
// ongoing story - reworded slightly by each outlet that picks it up over
// the following hours - would create a brand-new archive row every time,
// since each run's dedupe pass never checks against what's already stored.
// This is exactly what caused near-duplicate "Taylor Farms recalls
// lettuce..." rows to pile up a few hours apart. To fix this, every newly
// classified story is now also compared (same Jaccard title-similarity
// method dedupe.mjs already uses) against the existing archive before
// deciding whether to insert a new row or merge into an existing one.
//
// NOTE: this file only classifies NEWLY fetched articles. Existing archive
// rows are NOT reprocessed here - that's what scripts/reclassify-archive.mjs
// is for, which runs automatically whenever the classifier itself changes
// (see .github/workflows/pipeline.yml).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchAllFeeds } from "./fetch-feeds.mjs";
import { dedupeArticles, tokenize, jaccard, groupSimilarTitles } from "./dedupe.mjs";
import { categorizeClusters } from "./categorize.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const CATEGORIES_PATH = new URL("../config/categories.json", import.meta.url);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Keep 3 months of history, then permanently delete anything older - this
// keeps the archive from growing forever while still giving a much longer
// window than the old 7-day cutoff.
const RETENTION_DAYS = 90;

// Slightly lower than the intra-run threshold (0.55 in dedupe.mjs) - outlets
// picking up a story hours later tend to reword headlines more than two
// outlets covering breaking news in the same 10-minute window. Empirically
// tested against real examples: genuine reworded duplicates scored 0.31-0.40,
// while unrelated-but-topically-similar stories (different recall, different
// product, same numbers) scored no higher than 0.17 - so 0.30 catches real
// duplicates with a solid safety margin against false merges.
const CROSS_RUN_MATCH_THRESHOLD = 0.30;

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

/** Converts a categorized event (camelCase) into a brand-new row (snake_case)
 *  for a story never seen before. */
function newRowFromEvent(event, nowIso) {
  return {
    id: event.id,
    title: event.title,
    description: event.description || null,
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
    first_seen_at: nowIso,
    last_seen_at: nowIso
  };
}

/** Merges a newly-fetched event into an ALREADY-STORED archive row that
 *  turned out to be the same underlying story, just reworded by a
 *  different outlet. Keeps the original title and first_seen_at (so the
 *  story doesn't appear to "restart"), combines the source lists (deduped
 *  by URL), and refreshes the classification fields to the latest
 *  computed values, since those reflect the current classifier logic. */
function mergedRowFromMatch(newEvent, existingRow, nowIso) {
  const combinedSources = [...(existingRow.sources || [])];
  const existingUrls = new Set(combinedSources.map(s => s.url));
  for (const s of newEvent.sources) {
    if (!existingUrls.has(s.url)) { combinedSources.push(s); existingUrls.add(s.url); }
  }
  const uniqueDomains = new Set(combinedSources.map(s => s.domain));

  return {
    id: existingRow.id,
    title: existingRow.title,
    description: existingRow.description ?? (newEvent.description || null),
    bluf: existingRow.bluf,
    category: newEvent.category,
    category_label: newEvent.categoryLabel,
    category_color: newEvent.categoryColor,
    severity: newEvent.severity,
    country: existingRow.country && existingRow.country !== "Unknown" ? existingRow.country : newEvent.country,
    lat: existingRow.lat ?? newEvent.lat,
    lon: existingRow.lon ?? newEvent.lon,
    published_at: existingRow.published_at,
    source_count: uniqueDomains.size,
    sources: combinedSources,
    primary_url: existingRow.primary_url,
    primary_domain: existingRow.primary_domain,
    has_executive_title: newEvent.hasExecutiveTitle,
    corporate_score: newEvent.corporateScore,
    is_corporate: newEvent.isCorporate,
    is_likely_political: newEvent.isLikelyPolitical,
    first_seen_at: existingRow.first_seen_at,
    last_seen_at: nowIso
  };
}

/** Converts a Supabase "articles" row (snake_case) back into the camelCase
 *  event shape the frontend already expects from data/latest.json. */
function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
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

/** Fetches enough of the existing archive to check new stories against for
 *  cross-run duplicates - id, title, sources, and everything needed to
 *  build a merged row without a second round-trip per match. */
async function fetchExistingArchiveIndex() {
  const pageSize = 1000;
  let all = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=id,title,description,bluf,country,lat,lon,published_at,sources,first_seen_at,primary_url,primary_domain&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to read existing articles: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all.map(row => ({ ...row, _tokens: tokenize(row.title) }));
}

/** For each newly classified event, decides whether it's genuinely new or
 *  the same story as something already in the archive (just reworded by a
 *  different outlet, picked up hours later). Returns the final list of
 *  rows to upsert. */
/** Merges newly-fetched, newly-classified events against EACH OTHER before
 *  checking against the existing archive. Without this, several fresh
 *  articles that all match each other well, but happen to each score just
 *  under CROSS_RUN_MATCH_THRESHOLD against one specific (oddly-worded)
 *  existing archive row, would each get inserted as separate new rows -
 *  undoing whatever dedupe-archive.mjs merged on its last pass, every
 *  single cycle, in a repeating merge/split loop. This closes that gap. */
function consolidateNewEvents(newEvents) {
  if (newEvents.length < 2) return newEvents;
  const groups = groupSimilarTitles(newEvents, e => e.title, CROSS_RUN_MATCH_THRESHOLD);
  return groups.map(group => {
    if (group.length === 1) return group[0];
    const primary = group[0];
    const combinedSources = [];
    const seenUrls = new Set();
    for (const ev of group) {
      for (const s of ev.sources) {
        if (!seenUrls.has(s.url)) { combinedSources.push(s); seenUrls.add(s.url); }
      }
    }
    const uniqueDomains = new Set(combinedSources.map(s => s.domain));
    return { ...primary, sources: combinedSources, sourceCount: uniqueDomains.size };
  });
}

function resolveRows(newEvents, existingIndex, nowIso) {
  const rows = [];
  // Tracks archive rows already claimed by an earlier event THIS run, so two
  // new events don't both try to merge into the same existing row and only
  // one of them "wins" silently.
  const claimedExistingIds = new Set();

  for (const event of newEvents) {
    const tokens = tokenize(event.title);
    let bestMatch = null, bestScore = CROSS_RUN_MATCH_THRESHOLD;

    for (const existing of existingIndex) {
      if (claimedExistingIds.has(existing.id)) continue;
      const score = jaccard(tokens, existing._tokens);
      if (score >= bestScore) { bestScore = score; bestMatch = existing; }
    }

    if (bestMatch) {
      claimedExistingIds.add(bestMatch.id);
      rows.push(mergedRowFromMatch(event, bestMatch, nowIso));
    } else {
      rows.push(newRowFromEvent(event, nowIso));
    }
  }

  return rows;
}

/** Upserts the resolved rows (new inserts and merges alike) into the
 *  permanent archive. Uses Supabase's merge-duplicates upsert, matching on
 *  the "id" primary key - for merges, that id is the EXISTING row's id, so
 *  this correctly updates it in place rather than inserting a duplicate. */
async function upsertRows(rows) {
  if (!rows.length) return;
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
  console.log(`[build] clustered into ${clusters.length} unique stories (within this run)`);

  const newEvents = await categorizeClusters(clusters);
  console.log(`[build] ${newEvents.length} events classified as protective-intel relevant this run`);

  const consolidatedEvents = consolidateNewEvents(newEvents);
  console.log(`[build] consolidated into ${consolidatedEvents.length} unique stories after merging same-story duplicates from different outlets within this run`);

  console.log(`[build] checking against existing archive for cross-run duplicates...`);
  const existingIndex = await fetchExistingArchiveIndex();
  const nowIso = new Date().toISOString();
  const resolvedRows = resolveRows(consolidatedEvents, existingIndex, nowIso);
  const mergedCount = resolvedRows.filter(r => existingIndex.some(e => e.id === r.id)).length;
  console.log(`[build] ${resolvedRows.length - mergedCount} genuinely new stories, ${mergedCount} merged into existing archive rows (same story, different outlet/wording)`);

  console.log(`[build] upserting ${resolvedRows.length} rows into the permanent Supabase archive...`);
  await upsertRows(resolvedRows);

  console.log(`[build] pruning articles older than ${RETENTION_DAYS} days...`);
  await pruneOldArticles();

  console.log(`[build] reading back the full permanent archive...`);
  const events = await fetchFullArchive();
  events.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  console.log(`[build] archive now holds ${events.length} events total (last ${RETENTION_DAYS} days)`);

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
