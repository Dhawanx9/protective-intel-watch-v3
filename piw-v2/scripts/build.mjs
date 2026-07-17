// Orchestrates the full pipeline: fetch RSS -> dedupe -> categorize -> write JSON.
// This is what GitHub Actions runs on a schedule. The browser never touches RSS directly.
import { writeFile, mkdir } from "node:fs/promises";
import { fetchAllFeeds } from "./fetch-feeds.mjs";
import { dedupeArticles } from "./dedupe.mjs";
import { categorizeClusters } from "./categorize.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const MAX_AGE_DAYS = 7;

function withinWindow(items) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
  return items.filter(it => !it.publishedAt || new Date(it.publishedAt).getTime() >= cutoff);
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[build] starting pipeline run at ${startedAt}`);

  const { items, feedHealth } = await fetchAllFeeds();
  console.log(`[build] fetched ${items.length} raw articles across ${feedHealth.length} configured feeds`);

  const windowed = withinWindow(items);
  const clusters = dedupeArticles(windowed);
  console.log(`[build] clustered into ${clusters.length} unique stories`);

  const events = await categorizeClusters(clusters);
  console.log(`[build] ${events.length} events classified as protective-intel relevant`);

  events.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const finishedAt = new Date().toISOString();
  const meta = {
    generatedAt: finishedAt,
    startedAt,
    totalEventsCount: events.length,
    rawArticleCount: items.length,
    feedHealth,
    categoriesPresent: [...new Set(events.map(e => e.category))]
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL("latest.json", DATA_DIR), JSON.stringify({ meta, events }, null, 2));
  await writeFile(new URL("meta.json", DATA_DIR), JSON.stringify(meta, null, 2));

  console.log(`[build] wrote data/latest.json (${events.length} events) and data/meta.json`);
}

main().catch(err => {
  console.error("[build] pipeline failed:", err);
  process.exit(1);
});
