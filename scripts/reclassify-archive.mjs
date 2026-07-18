// Reprocesses EVERY article already stored in the permanent Supabase archive
// using the CURRENT classifier logic (categorize.mjs's classifyArticle).
//
// Why this exists: build.mjs only classifies newly-fetched articles each run.
// Without this script, every time categorize.mjs, categories.json,
// nationality-aliases.json, or corporate-signals.mjs gets tuned, the fix
// would only apply going forward - anything already stored would silently
// keep its old, possibly wrong category/severity/country forever (until it
// aged out at 90 days). This script closes that gap: it's run automatically
// by GitHub Actions whenever one of those classifier files changes (see
// .github/workflows/pipeline.yml), so a fix here always applies retroactively
// to the whole site, with no manual SQL step ever needed.
//
// Articles stored before the "description" column existed won't have a
// description to work with - they're reclassified on title alone, which is
// still strictly better than never being reprocessed at all.
import { loadClassifierConfigs, classifyArticle } from "./categorize.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
      `${SUPABASE_URL}/rest/v1/articles?select=*&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) throw new Error(`Failed to read archive: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/** Articles that no longer match ANY category under current rules (e.g. a
 *  keyword was removed, or a new noise filter now catches them) are DELETED
 *  from the archive rather than left with a stale category - this is exactly
 *  the "golf story", "satire piece", "political statement" cleanup that used
 *  to require manual SQL, now handled automatically. */
async function deleteRows(ids) {
  if (!ids.length) return;
  const CHUNK_SIZE = 100;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const filter = chunk.map(id => encodeURIComponent(id)).join(",");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=in.(${filter})`, {
      method: "DELETE",
      headers: supabaseHeaders({ Prefer: "return=minimal" })
    });
    if (!res.ok) throw new Error(`Failed to delete stale rows: HTTP ${res.status} ${await res.text()}`);
  }
}

async function updateRows(updates) {
  if (!updates.length) return;
  const CHUNK_SIZE = 200;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(chunk)
    });
    if (!res.ok) throw new Error(`Failed to update reclassified rows (chunk starting at ${i}): HTTP ${res.status} ${await res.text()}`);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
  }

  console.log("[reclassify] loading current classifier configs...");
  const configs = await loadClassifierConfigs();

  console.log("[reclassify] reading full archive...");
  const rows = await fetchAllRows();
  console.log(`[reclassify] ${rows.length} rows to check`);

  const toDelete = [];
  const toUpdate = [];
  let unchanged = 0;

  for (const row of rows) {
    const result = classifyArticle({
      title: row.title,
      description: row.description || "",
      domain: row.primary_domain,
      region: null, // archive rows have no feed region - fall back to existing country instead
      existingCountry: row.country && row.country !== "Unknown" ? row.country : null,
    }, configs);

    if (!result) {
      toDelete.push(row.id);
      continue;
    }

    const changed =
      result.category !== row.category ||
      result.severity !== row.severity ||
      result.country !== row.country ||
      result.isCorporate !== row.is_corporate ||
      result.isLikelyPolitical !== row.is_likely_political;

    if (!changed) { unchanged++; continue; }

    toUpdate.push({
      id: row.id,
      title: row.title,
      description: row.description || null,
      bluf: row.bluf,
      category: result.category,
      category_label: result.categoryLabel,
      category_color: result.categoryColor,
      severity: result.severity,
      country: result.country,
      lat: result.lat,
      lon: result.lon,
      published_at: row.published_at,
      source_count: row.source_count,
      sources: row.sources,
      primary_url: row.primary_url,
      primary_domain: row.primary_domain,
      has_executive_title: result.hasExecutiveTitle,
      corporate_score: result.corporateScore,
      is_corporate: result.isCorporate,
      is_likely_political: result.isLikelyPolitical,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
    });
  }

  console.log(`[reclassify] ${unchanged} unchanged, ${toUpdate.length} to update, ${toDelete.length} to delete (no longer relevant under current rules)`);

  await updateRows(toUpdate);
  await deleteRows(toDelete);

  console.log("[reclassify] done.");
}

main().catch(err => {
  console.error("[reclassify] failed:", err);
  process.exit(1);
});
