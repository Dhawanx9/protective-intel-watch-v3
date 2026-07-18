// Step 3: assign each clustered story to a threat category, score its severity,
// detect whether it's corporate/MNC-relevant vs. political/other, and drop
// anything that isn't relevant to protective intelligence at all.
import { readFile } from "node:fs/promises";
import { analyzeCorporateSignal } from "./corporate-signals.mjs";

const CATEGORIES_PATH = new URL("../config/categories.json", import.meta.url);
const COUNTRIES_PATH = new URL("../config/countries.json", import.meta.url);
const NATIONALITY_ALIASES_PATH = new URL("../config/nationality-aliases.json", import.meta.url);

// Categories where, if the story ALSO names an actual executive title
// (CEO, Chairman, Director, etc.), it should be reclassified as an Executive
// Threat instead - e.g. "CEO kidnapped" belongs in Executive Threats, not
// just Kidnapping. Without an executive title present, these categories
// keep their own natural classification.
const RECLASSIFY_TO_EXECUTIVE_IF_TITLED = new Set([
  "kidnapping", "crime", "terrorism", "political_instability", "geopolitical",
]);

function isPositiveNoise(title, positiveExclude) {
  const low = title.toLowerCase();
  return positiveExclude.some(w => low.includes(w));
}

/** Sports/entertainment stories often share vocabulary with real threat
 *  keywords by coincidence (golf "shooting a round", box-office "explosive
 *  opening", etc). This is a second, independent noise filter alongside
 *  positiveExclude, specifically for that category of false positive. */
function isIrrelevantNoise(title, irrelevantExclude) {
  const low = title.toLowerCase();
  return (irrelevantExclude || []).some(w => low.includes(w));
}

/** First-person essays, memoirs, and op-eds often use dramatic threat-adjacent
 *  language ("I survived...", "I evaded...") but aren't news events at all -
 *  they're personal narrative pieces, sometimes published years after the
 *  fact. Filtered out the same way as sports/entertainment noise. */
function isNarrativeNoise(title, narrativeExclude) {
  const low = title.toLowerCase();
  return (narrativeExclude || []).some(w => low.includes(w));
}

/** Satire sites occasionally get picked up by RSS aggregation the same way
 *  real news does. Checked by domain rather than title text, since satire
 *  headlines are deliberately written to sound like real news. */
function isSatireSource(primaryDomain, satireDomains) {
  if (!primaryDomain) return false;
  return (satireDomains || []).some(d => primaryDomain.toLowerCase().includes(d));
}

function classify(title, categories) {
  const low = title.toLowerCase();
  let best = null, bestHits = 0;
  for (const cat of categories) {
    const hits = cat.keywords.reduce((n, w) => low.includes(w) ? n + 1 : n, 0);
    if (hits > bestHits) { bestHits = hits; best = cat; }
  }
  return best;
}

function severityOf(title, severityConfig) {
  const low = title.toLowerCase();
  if (severityConfig.high.some(w => low.includes(w))) return "HIGH";
  if (severityConfig.medium.some(w => low.includes(w))) return "MEDIUM";
  return "LOW";
}

/** Very light BLUF (Bottom Line Up Front) generator: first clause of the headline,
 *  plus a stock line naming the category and outlet spread. This is a deterministic,
 *  rule-based summary - not an LLM call - since the pipeline has no API key by default. */
function generateBLUF(cluster, category) {
  const lead = cluster.title.split(/[:\-–—]/)[0].trim();
  const outlets = cluster.sourceCount > 1 ? `Reported by ${cluster.sourceCount} outlets.` : `Reported by 1 outlet.`;
  return `${lead}. Classified under ${category.label}. ${outlets}`;
}

const REGION_FALLBACK = { India: "India", UK: "United Kingdom", USA: "United States" };

/** Detects country by: (1) exact country name mention, (2) nationality
 *  adjective or major city name via the alias map (e.g. "Iranian", "Tehran"
 *  -> Iran), (3) the feed's own region as a last-resort approximation. This
 *  catches the large share of stories that reference a country indirectly
 *  ("Iranian officials said...") rather than naming it outright. */
function detectCountry(cluster, countries, nationalityAliases) {
  const names = Object.keys(countries);
  const hay = (cluster.title + " " + (cluster.items[0]?.description || "")).toLowerCase();

  for (const name of names) {
    if (hay.includes(name.toLowerCase())) return name;
  }

  for (const [alias, country] of Object.entries(nationalityAliases || {})) {
    if (hay.includes(alias)) return country;
  }

  return REGION_FALLBACK[cluster.items[0]?.region] || null;
}

export async function categorizeClusters(clusters) {
  const { categories, severity, positiveExclude, irrelevantExclude, narrativeExclude, satireDomains } =
    JSON.parse(await readFile(CATEGORIES_PATH, "utf8"));
  const countries = JSON.parse(await readFile(COUNTRIES_PATH, "utf8"));
  const nationalityAliases = JSON.parse(await readFile(NATIONALITY_ALIASES_PATH, "utf8"));
  const executiveThreatsCategory = categories.find(c => c.id === "executive_threats");
  const out = [];

  for (const cluster of clusters) {
    if (isPositiveNoise(cluster.title, positiveExclude)) continue;
    if (isIrrelevantNoise(cluster.title, irrelevantExclude)) continue;
    if (isNarrativeNoise(cluster.title, narrativeExclude)) continue;
    if (isSatireSource(cluster.items[0]?.domain, satireDomains)) continue;

    let category = classify(cluster.title, categories);
    if (!category) continue; // not relevant to protective intelligence - drop it

    const country = detectCountry(cluster, countries, nationalityAliases);
    const coords = country ? countries[country] : null;

    const description = cluster.items[0]?.description || "";
    const { hasExecutiveTitle, corporateScore, isCorporate, isLikelyPolitical } =
      analyzeCorporateSignal(cluster.title, description);

    if (hasExecutiveTitle && executiveThreatsCategory && RECLASSIFY_TO_EXECUTIVE_IF_TITLED.has(category.id)) {
      category = executiveThreatsCategory;
    }

    out.push({
      id: cluster.id,
      title: cluster.title,
      bluf: generateBLUF(cluster, category),
      category: category.id,
      categoryLabel: category.label,
      categoryColor: category.color,
      severity: severityOf(cluster.title, severity),
      country: country || "Unknown",
      lat: coords ? coords[0] : null,
      lon: coords ? coords[1] : null,
      publishedAt: cluster.publishedAt,
      sourceCount: cluster.sourceCount,
      sources: cluster.items.map(it => ({ domain: it.domain, label: it.sourceLabel, url: it.url, publishedAt: it.publishedAt })),
      primaryUrl: cluster.items[0].url,
      primaryDomain: cluster.items[0].domain,
      hasExecutiveTitle,
      corporateScore,
      isCorporate,
      isLikelyPolitical,
    });
  }

  out.sort((a, b) => b.corporateScore - a.corporateScore);

  return out;
}
