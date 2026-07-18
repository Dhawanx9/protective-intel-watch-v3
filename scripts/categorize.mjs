// Step 3: assign each clustered story to a threat category, score its severity,
// detect whether it's corporate/MNC-relevant vs. political/other, and drop
// anything that isn't relevant to protective intelligence at all.
import { readFile } from "node:fs/promises";
import { analyzeCorporateSignal } from "./corporate-signals.mjs";

const CATEGORIES_PATH = new URL("../config/categories.json", import.meta.url);
const COUNTRIES_PATH = new URL("../config/countries.json", import.meta.url);

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

function detectCountry(cluster, countries) {
  const names = Object.keys(countries);
  const hay = (cluster.title + " " + (cluster.items[0]?.description || "")).toLowerCase();
  for (const name of names) {
    if (hay.includes(name.toLowerCase())) return name;
  }
  // No explicit country mentioned - fall back to the feed's own region as an
  // approximation, so Threats-by-Country and the map get something instead
  // of piling everything into "Unknown".
  return REGION_FALLBACK[cluster.items[0]?.region] || null;
}

export async function categorizeClusters(clusters) {
  const { categories, severity, positiveExclude, irrelevantExclude } = JSON.parse(await readFile(CATEGORIES_PATH, "utf8"));
  const countries = JSON.parse(await readFile(COUNTRIES_PATH, "utf8"));
  const out = [];

  for (const cluster of clusters) {
    if (isPositiveNoise(cluster.title, positiveExclude)) continue;
    if (isIrrelevantNoise(cluster.title, irrelevantExclude)) continue;

    const category = classify(cluster.title, categories);
    if (!category) continue; // not relevant to protective intelligence - drop it

    const country = detectCountry(cluster, countries);
    const coords = country ? countries[country] : null;

    // Corporate/MNC signal - applies across every category, not just Executive
    // Threats. We are a corporate-focused team: when the same words could be
    // read either politically or corporately (e.g. "President", "Director"),
    // corporate context should rank first. Political/other stories are never
    // hidden - they're just deprioritized relative to corporate ones.
    const description = cluster.items[0]?.description || "";
    const { hasExecutiveTitle, corporateScore, isCorporate, isLikelyPolitical } =
      analyzeCorporateSignal(cluster.title, description);

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
      // New fields for corporate prioritization - safe to ignore if the
      // frontend doesn't read them yet, nothing existing is removed.
      hasExecutiveTitle,
      corporateScore,
      isCorporate,
      isLikelyPolitical,
    });
  }

  // Corporate-first ordering: within the already-assembled list, push higher
  // corporateScore items earlier. Array.prototype.sort in Node is stable, so
  // stories with equal scores keep their original relative order (which
  // reflects recency from the clustering step) - political/other stories
  // still appear, just further down.
  out.sort((a, b) => b.corporateScore - a.corporateScore);

  return out;
}
