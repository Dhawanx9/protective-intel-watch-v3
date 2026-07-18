// Step 1 of the pipeline: fetch every enabled RSS/Atom feed and normalize each entry
// into a common article shape. Runs server-side in GitHub Actions - never in the browser.
// The feed LIST itself now lives in Supabase (managed live from the Feed Manager UI),
// not in config/feeds.json — this just reads it via Supabase's REST API (PostgREST),
// with plain fetch(), no SDK needed server-side.
import { XMLParser } from "fast-xml-parser";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Decodes HTML entities left in feed text after XML parsing. Many RSS feeds
 *  double-escape their titles in the source XML (e.g. "&amp;#8217;"), so the
 *  XML parser only unescapes the outer "&amp;" -> "&", leaving a literal
 *  "&#8217;" string in the text instead of the actual character ('). This
 *  runs a second pass to catch both numeric character references (&#8217;,
 *  &#x2019;) and the common named entities. */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function textOf(node) {
  if (typeof node === "string") return decodeEntities(node);
  if (node && typeof node === "object" && "#text" in node) return decodeEntities(String(node["#text"]));
  return "";
}

/** Reads the active feed list from Supabase (public read policy - see supabase/schema.sql). */
async function fetchFeedListFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set. The pipeline needs these as GitHub Actions repository variables — see README.md.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feeds?enabled=eq.true&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase feed list request failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** Parses RSS 2.0 <item> or Atom <entry> nodes into {title, url, publishedAt} */
function parseFeedXml(xml) {
  let doc;
  try { doc = parser.parse(xml); } catch { return []; }

  const items = [];

  const rssItems = asArray(doc?.rss?.channel?.item);
  for (const it of rssItems) {
    const title = textOf(it.title).trim();
    const url = textOf(it.link).trim();
    const pub = textOf(it.pubDate) || textOf(it["dc:date"]);
    const description = textOf(it.description).trim();
    if (title && url) items.push({ title, url, publishedAt: pub ? new Date(pub).toISOString() : null, description });
  }

  const atomEntries = asArray(doc?.feed?.entry);
  for (const it of atomEntries) {
    const title = textOf(it.title).trim();
    let url = "";
    if (Array.isArray(it.link)) {
      const alt = it.link.find(l => l["@_rel"] === "alternate") || it.link[0];
      url = alt ? alt["@_href"] : "";
    } else if (it.link) {
      url = it.link["@_href"] || textOf(it.link);
    }
    const pub = textOf(it.published) || textOf(it.updated);
    const description = textOf(it.summary) || textOf(it.content);
    if (title && url) items.push({ title, url, publishedAt: pub ? new Date(pub).toISOString() : null, description });
  }

  return items;
}

/** True if a response body actually looks like RSS/Atom XML rather than an HTML page. */
function looksLikeFeed(text) {
  const head = text.slice(0, 800);
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<\?xml/i.test(head);
}

/** Standard feed auto-discovery: nearly every site with RSS advertises it via a
 *  <link rel="alternate" type="application/rss+xml" href="..."> tag in its HTML
 *  <head>. This is the same mechanism real RSS reader apps use - not scraping,
 *  just reading a tag the site itself publishes for exactly this purpose. */
function discoverFeedUrl(html, baseUrl) {
  const linkTagRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkTagRe.exec(html))) {
    const tag = m[0];
    if (/type=["'](application\/rss\+xml|application\/atom\+xml)["']/i.test(tag)) {
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        try { return new URL(hrefMatch[1], baseUrl).toString(); }
        catch { return hrefMatch[1]; }
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url, timeoutMs, controller) {
  const res = await fetch(url, {
    signal: controller.signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fetches feed.url as-is; if it's not actually XML (e.g. someone pasted a
 *  homepage instead of a feed URL), auto-discovers the real feed link from
 *  the page's own <link> tag and fetches that instead. */
async function resolveAndFetchXml(url, timeoutMs, controller) {
  const text = await fetchWithTimeout(url, timeoutMs, controller);
  if (looksLikeFeed(text)) return text;

  const discovered = discoverFeedUrl(text, url);
  if (!discovered) throw new Error("No RSS/Atom feed found on this page (no <link rel=\"alternate\"> tag) - this site may not publish RSS at all.");

  const feedText = await fetchWithTimeout(discovered, timeoutMs, controller);
  if (!looksLikeFeed(feedText)) throw new Error(`Discovered link (${discovered}) didn't return valid RSS/Atom either.`);
  return feedText;
}

export async function fetchAllFeeds({ timeoutMs = 15000 } = {}) {
  const enabled = await fetchFeedListFromSupabase();

  const results = await Promise.allSettled(enabled.map(async feed => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const xml = await resolveAndFetchXml(feed.url, timeoutMs, controller);
      const items = parseFeedXml(xml).map(it => ({
        ...it,
        domain: domainOf(it.url),
        sourceLabel: feed.label,
        sourceId: feed.id,
        region: feed.region || "Unknown"
      }));
      return { feedId: feed.id, status: "ok", count: items.length, items };
    } catch (err) {
      return { feedId: feed.id, status: "error", count: 0, items: [], error: String(err.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }));

  const feedHealth = [];
  let allItems = [];
  results.forEach((r, i) => {
    const feed = enabled[i];
    if (r.status === "fulfilled") {
      feedHealth.push({ id: feed.id, label: feed.label, status: r.value.status, count: r.value.count, error: r.value.error || null, checkedAt: new Date().toISOString() });
      allItems = allItems.concat(r.value.items);
    } else {
      feedHealth.push({ id: feed.id, label: feed.label, status: "error", count: 0, error: String(r.reason), checkedAt: new Date().toISOString() });
    }
  });

  return { items: allItems, feedHealth };
}
