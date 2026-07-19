// Runs EVERY pipeline cycle (unlike reclassify-archive.mjs, which only runs
// when classifier files change) - scans the entire permanent archive for
// duplicate stories that slipped through, and merges them.
//
// Why this exists on top of build.mjs's cross-run check: build.mjs only
// checks NEWLY fetched stories against the existing archive at insert time.
// This is a second, independent safety net that periodically re-scans the
// WHOLE archive against itself, catching anything that slipped through -
// including every duplicate that already existed before this system was
// introduced. This is meant to run indefinitely, not as a one-off cleanup:
// the goal is that duplicate stories are never something a person needs to
// notice and ask for a manual fix.
import { tokenize, jaccard } from "./dedupe.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Same threshold as build.mjs's cross-run check, validated against real
// examples: genuine duplicates scored 0.31-0.40, unrelated-but-similar
// stories topped out at 0.17.
const MATCH_THRESHOLD = 0.30;

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function fetchAllRows() {
  const pageSize = 1000;
  let all = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=*&order=first_seen_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to read archive: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  // Ordered oldest-first, so within any duplicate group the earliest-seen
  // row is naturally first - that's the one we keep as the "primary".
  return all.map(row => ({ ...row, _tokens: tokenize(row.title) }));
}

/** Groups rows into duplicate clusters using the same Jaccard similarity
 *  approach as dedupe.mjs/build.mjs - but unlike a simple "compare everything
 *  to the first row" pass, this finds TRANSITIVE groups: if story A matches
 *  story B, and story B matches story C, then A/B/C are all one cluster,
 *  even if A and C don't directly score above the threshold against each
 *  other. This matters in practice: a story reworded multiple times over
 *  several hours often drifts enough that the first and last versions don't
 *  match directly, but each is close to its neighbors in between. Without
 *  transitive grouping, a story like that gets split - the middle versions
 *  merge into the first, but the last one is left stranded alone, exactly
 *  the bug that let "Taylor Farms reveals its full recall list..." sit
 *  unmerged despite being the same story as three other rows. */
function findDuplicateClusters(rows) {
  const n = rows.length;
  const adjacency = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccard(rows[i]._tokens, rows[j]._tokens) >= MATCH_THRESHOLD) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const group = [];
    const queue = [i];
    visited.add(i);

    while (queue.length) {
      const current = queue.shift();
      group.push(rows[current]);
      for (const neighbor of adjacency[current]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (group.length > 1) {
      // Keep the earliest-seen row first within the group, since rows[]
      // itself is sorted oldest-first but BFS traversal order doesn't
      // preserve that - mergeCluster() expects group[0] to be the primary.
      group.sort((a, b) => new Date(a.first_seen_at) - new Date(b.first_seen_at));
      clusters.push(group);
    }
  }

  return clusters;
}

/** Merges a cluster of duplicate rows into one. Keeps the earliest-seen
 *  row's identity (id, title, first_seen_at) so the story doesn't appear to
 *  "restart", combines every source across the whole cluster (deduped by
 *  URL), and refreshes last_seen_at to now. */
function mergeCluster(cluster, nowIso) {
  const primary = cluster[0];
  const combinedSources = [];
  const seenUrls = new Set();
  for (const row of cluster) {
    for (const s of row.sources || []) {
      if (!seenUrls.has(s.url)) { combinedSources.push(s); seenUrls.add(s.url); }
    }
  }
  const uniqueDomains = new Set(combinedSources.map(s => s.domain));

  const mergedRow = {
    id: primary.id,
    title: primary.title,
    description: primary.description,
    bluf: primary.bluf,
    category: primary.category,
    category_label: primary.category_label,
    category_color: primary.category_color,
    severity: primary.severity,
    country: primary.country,
    lat: primary.lat,
    lon: primary.lon,
    published_at: primary.published_at,
    source_count: uniqueDomains.size,
    sources: combinedSources,
    primary_url: primary.primary_url,
    primary_domain: primary.primary_domain,
    has_executive_title: primary.has_executive_title,
    corporate_score: primary.corporate_score,
    is_corporate: primary.is_corporate,
    is_likely_political: primary.is_likely_political,
    first_seen_at: primary.first_seen_at,
    last_seen_at: nowIso,
  };

  const rowsToDelete = cluster.slice(1);
  return { mergedRow, rowsToDelete };
}

async function updateRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?on_conflict=id`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([row])
  });
  if (!res.ok) throw new Error(`Failed to update merged row "${row.title}": HTTP ${res.status} ${await res.text()}`);
}

async function deleteRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${encodeURIComponent(row.id)}`, {
    method: "DELETE",
    headers: supabaseHeaders({ Prefer: "return=representation" })
  });
  if (!res.ok) throw new Error(`Failed to delete duplicate "${row.title}": HTTP ${res.status} ${await res.text()}`);
  const deleted = await res.json();
  if (deleted.length === 0) {
    console.warn(`[dedupe-archive] WARNING: delete for duplicate "${row.title}" matched ZERO rows - id: ${JSON.stringify(row.id)}`);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
  }

  console.log("[dedupe-archive] reading full archive...");
  const rows = await fetchAllRows();
  console.log(`[dedupe-archive] ${rows.length} rows to check`);

  const clusters = findDuplicateClusters(rows);
  const totalDuplicates = clusters.reduce((sum, c) => sum + c.length - 1, 0);
  console.log(`[dedupe-archive] found ${clusters.length} duplicate group(s), ${totalDuplicates} row(s) to merge away`);

  const nowIso = new Date().toISOString();
  for (const cluster of clusters) {
    const { mergedRow, rowsToDelete } = mergeCluster(cluster, nowIso);
    console.log(`[dedupe-archive] merging ${cluster.length} rows into: "${mergedRow.title}" (${mergedRow.source_count} sources)`);
    for (const dup of rowsToDelete) {
      console.log(`[dedupe-archive]   - absorbing duplicate: "${dup.title}"`);
    }
    await updateRow(mergedRow);
    for (const dup of rowsToDelete) {
      await deleteRow(dup);
    }
  }

  console.log("[dedupe-archive] done.");
}

main().catch(err => {
  console.error("[dedupe-archive] failed:", err);
  process.exit(1);
});
