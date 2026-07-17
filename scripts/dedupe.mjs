// Step 2: cluster near-duplicate headlines (same story, multiple outlets) and
// filter out spam / boilerplate entries before they reach categorization.

const STOPWORDS = new Set(["the","a","an","of","in","on","at","to","for","and","or","with","after","over","amid","as","is","are","was","were","by","from","its","his","her","their","new","says","said","into"]);

function tokenize(title) {
  return (title || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  sa.forEach(x => { if (sb.has(x)) inter++; });
  return inter / new Set([...sa, ...sb]).size;
}

const SPAM_PATTERNS = [
  /^advertisement$/i, /^sponsored/i, /^\[?paid content\]?$/i, /click here/i,
  /^subscribe to/i, /^\s*$/
];

function isSpam(title) {
  if (!title || title.length < 8) return true;
  return SPAM_PATTERNS.some(rx => rx.test(title));
}

/** Groups raw articles into clusters of the same underlying story. */
export function dedupeArticles(items) {
  const clean = items.filter(it => !isSpam(it.title));
  const clusters = [];

  for (const art of clean) {
    const tokens = tokenize(art.title);
    let best = null, bestScore = 0;
    for (const cl of clusters) {
      const score = jaccard(tokens, cl.tokens);
      if (score > bestScore) { bestScore = score; best = cl; }
    }
    if (best && bestScore >= 0.55) {
      best.items.push(art);
      if (art.publishedAt && (!best.latestAt || art.publishedAt > best.latestAt)) {
        best.latestAt = art.publishedAt;
        best.title = art.title;
      }
      best.domains.add(art.domain);
    } else {
      clusters.push({
        id: art.url,
        title: art.title,
        latestAt: art.publishedAt,
        tokens,
        items: [art],
        domains: new Set([art.domain])
      });
    }
  }

  return clusters.map(cl => ({
    id: cl.id,
    title: cl.title,
    publishedAt: cl.latestAt || new Date().toISOString(),
    items: cl.items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
    sourceCount: cl.domains.size
  }));
}
