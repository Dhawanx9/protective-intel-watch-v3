// Step 2: cluster near-duplicate headlines (same story, multiple outlets) and
// filter out spam / boilerplate entries before they reach categorization.
const STOPWORDS = new Set(["the","a","an","of","in","on","at","to","for","and","or","with","after","over","amid","as","is","are","was","were","by","from","its","his","her","their","new","says","said","into"]);
export function tokenize(title) {
  return (title || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}
export function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  sa.forEach(x => { if (sb.has(x)) inter++; });
  return inter / new Set([...sa, ...sb]).size;
}

/** Generic transitive similarity clustering: groups items where similarity
 *  chains (if A matches B, and B matches C, then A/B/C are one group, even
 *  if A and C don't score above threshold directly against each other).
 *  Used by build.mjs to group newly-fetched articles against EACH OTHER
 *  before comparing against the existing archive - without this, several
 *  fresh articles that all match each other but happen to score too low
 *  against one specific existing archive row (an oddly-worded title) would
 *  each get inserted as separate new rows, undoing any earlier merge on
 *  the very next pipeline run. */
export function groupSimilarTitles(items, titleOf, threshold) {
  const tokensList = items.map(it => tokenize(titleOf(it)));
  const n = items.length;
  const adjacency = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccard(tokensList[i], tokensList[j]) >= threshold) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  const visited = new Set();
  const groups = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const group = [];
    const queue = [i];
    visited.add(i);
    while (queue.length) {
      const current = queue.shift();
      group.push(items[current]);
      for (const neighbor of adjacency[current]) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    groups.push(group);
  }

  return groups;
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
