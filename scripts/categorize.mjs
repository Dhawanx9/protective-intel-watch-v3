// Step 3: assign each clustered story to a threat category, score its severity,
// detect whether it's corporate/MNC-relevant vs. political/other, and drop
// anything that isn't relevant to protective intelligence at all.
//
// The per-article classification logic lives in classifyArticle() below, kept
// separate from categorizeClusters() (which just loops over fresh RSS
// clusters) so that scripts/reclassify-archive.mjs can reuse the EXACT same
// logic against already-stored articles. Without this split, every time the
// classifier is tuned, only newly-fetched articles would benefit - anything
// already in the archive would silently keep its old, possibly wrong
// category forever. This is the single source of truth for classification;
// nothing else should reimplement it.
import { readFile } from "node:fs/promises";
import { analyzeCorporateSignal, hasExecutiveIncidentNearby } from "./corporate-signals.mjs";

const CATEGORIES_PATH = new URL("../config/categories.json", import.meta.url);
const COUNTRIES_PATH = new URL("../config/countries.json", import.meta.url);
const NATIONALITY_ALIASES_PATH = new URL("../config/nationality-aliases.json", import.meta.url);

const REGION_FALLBACK = { India: "India", UK: "United Kingdom", USA: "United States" };

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
function generateBLUF(title, sourceCount, category) {
  const lead = title.split(/[:\-–—]/)[0].trim();
  const outlets = sourceCount > 1 ? `Reported by ${sourceCount} outlets.` : `Reported by 1 outlet.`;
  return `${lead}. Classified under ${category.label}. ${outlets}`;
}

/** Detects country by: (1) exact country name mention, (2) nationality
 *  adjective or major city name via the alias map (e.g. "Iranian", "Tehran"
 *  -> Iran), (3) a caller-supplied fallback (the feed's region for fresh
 *  articles, or the previously-stored country when reprocessing the archive
 *  so we don't downgrade a correct country to "Unknown" just because region
 *  info isn't available at reclassification time). */
function detectCountry(title, description, countries, nationalityAliases, fallback) {
  const names = Object.keys(countries);
  const hay = (title + " " + (description || "")).toLowerCase();

  for (const name of names) {
    if (hay.includes(name.toLowerCase())) return name;
  }

  for (const [alias, country] of Object.entries(nationalityAliases || {})) {
    if (hay.includes(alias)) return country;
  }

  return fallback || null;
}

/** Loads all three config files once. Call this at the start of a batch job
 *  (a pipeline run, or a full archive reclassification) and reuse the same
 *  configs object across every article instead of re-reading files per item. */
export async function loadClassifierConfigs() {
  const { categories, severity, positiveExclude, irrelevantExclude, narrativeExclude, satireDomains } =
    JSON.parse(await readFile(CATEGORIES_PATH, "utf8"));
  const countries = JSON.parse(await readFile(COUNTRIES_PATH, "utf8"));
  const nationalityAliases = JSON.parse(await readFile(NATIONALITY_ALIASES_PATH, "utf8"));
  const executiveThreatsCategory = categories.find(c => c.id === "executive_threats");
  return { categories, severity, positiveExclude, irrelevantExclude, narrativeExclude, satireDomains, countries, nationalityAliases, executiveThreatsCategory };
}

/**
 * Classifies a single article. Returns null if the article should be dropped
 * (noise, satire, narrative piece, or no relevant category matched).
 *
 * IMPORTANT: Executive Threats is deliberately NOT part of the normal
 * keyword-matching pool (see classify() call below, which excludes it).
 * A bare incident word like "extortion" or "misconduct" matches all sorts of
 * unrelated stories (police corruption, random crime, celebrity gossip) -
 * it only means something as an EXECUTIVE threat when paired with an actual
 * executive title AND genuine corporate context AND isn't reading as
 * political. All three conditions are required together; none of them
 * alone is sufficient. This was the repeated source of false positives
 * (bare "chairman"/"ceo" mentions, then bare "extortion"/"kidnap" mentions) -
 * fixing it structurally here instead of patching one keyword at a time.
 *
 * @param {object} article - { title, description, domain, region, existingCountry }
 * @param {object} configs - result of loadClassifierConfigs()
 */
export function classifyArticle(article, configs) {
  const { title, description = "", domain = null, region = null, existingCountry = null } = article;
  const { categories, severity, positiveExclude, irrelevantExclude, narrativeExclude, satireDomains, countries, nationalityAliases, executiveThreatsCategory } = configs;

  if (isPositiveNoise(title, positiveExclude)) return null;
  if (isIrrelevantNoise(title, irrelevantExclude)) return null;
  if (isNarrativeNoise(title, narrativeExclude)) return null;
  if (isSatireSource(domain, satireDomains)) return null;

  // Executive Threats is excluded from the normal candidate pool - it's only
  // ever assigned below, via the strict three-part check.
  const nonExecutiveCategories = categories.filter(c => c.id !== "executive_threats");
  let category = classify(title, nonExecutiveCategories);

  const { hasExecutiveTitle, corporateScore, isCorporate, isLikelyPolitical } =
    analyzeCorporateSignal(title, description);

  // The title and the incident phrase must appear NEAR each other in the
  // text (not just anywhere in the same article) - this is what stops a
  // police "Director" mentioned in an unrelated paragraph of a terrorism
  // story from ever counting as an executive incident.
  const fullText = `${title} ${description}`;
  const hasExecutiveIncidentNear = executiveThreatsCategory
    ? hasExecutiveIncidentNearby(fullText, executiveThreatsCategory.keywords)
    : false;

  const isGenuineExecutiveThreat =
    hasExecutiveIncidentNear && isCorporate && !isLikelyPolitical;

  if (isGenuineExecutiveThreat && executiveThreatsCategory) {
    category = executiveThreatsCategory;
  }

  if (!category) return null; // not relevant to protective intelligence - drop it

  const regionFallback = region ? (REGION_FALLBACK[region] || null) : null;
  const country = detectCountry(title, description, countries, nationalityAliases, regionFallback || existingCountry);

  return {
    category: category.id,
    categoryLabel: category.label,
    categoryColor: category.color,
    severity: severityOf(title, severity),
    country: country || "Unknown",
    lat: country && countries[country] ? countries[country][0] : null,
    lon: country && countries[country] ? countries[country][1] : null,
    hasExecutiveTitle,
    corporateScore,
    isCorporate,
    isLikelyPolitical,
  };
}

export async function categorizeClusters(clusters) {
  const configs = await loadClassifierConfigs();
  const out = [];

  for (const cluster of clusters) {
    const description = cluster.items[0]?.description || "";
    const result = classifyArticle({
      title: cluster.title,
      description,
      domain: cluster.items[0]?.domain,
      region: cluster.items[0]?.region,
    }, configs);

    if (!result) continue;

    out.push({
      id: cluster.id,
      title: cluster.title,
      description,
      bluf: generateBLUF(cluster.title, cluster.sourceCount, configs.categories.find(c => c.id === result.category)),
      category: result.category,
      categoryLabel: result.categoryLabel,
      categoryColor: result.categoryColor,
      severity: result.severity,
      country: result.country,
      lat: result.lat,
      lon: result.lon,
      publishedAt: cluster.publishedAt,
      sourceCount: cluster.sourceCount,
      sources: cluster.items.map(it => ({ domain: it.domain, label: it.sourceLabel, url: it.url, publishedAt: it.publishedAt })),
      primaryUrl: cluster.items[0].url,
      primaryDomain: cluster.items[0].domain,
      hasExecutiveTitle: result.hasExecutiveTitle,
      corporateScore: result.corporateScore,
      isCorporate: result.isCorporate,
      isLikelyPolitical: result.isLikelyPolitical,
    });
  }

  out.sort((a, b) => b.corporateScore - a.corporateScore);

  return out;
}
