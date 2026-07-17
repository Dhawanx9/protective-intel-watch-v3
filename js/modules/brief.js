import { store } from "../state.js";
import { escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";

export function initBrief() {
  render();
  store.subscribe(topic => { if (topic === "events") render(); });
}

function render() {
  if (!store.data.loaded) return;
  const events = store.data.events;

  const top10 = [...events].sort((a, b) => {
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return (rank[b.severity] - rank[a.severity]) || (b.sourceCount - a.sourceCount) || (new Date(b.publishedAt) - new Date(a.publishedAt));
  }).slice(0, 10);

  const critical = events.filter(e => e.severity === "HIGH" && e.sourceCount >= 3).slice(0, 8);

  const catCounts = {};
  events.forEach(e => { catCounts[e.categoryLabel] = (catCounts[e.categoryLabel] || 0) + 1; });
  const trending = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const regionCounts = {};
  events.forEach(e => { if (e.country && e.country !== "Unknown") regionCounts[e.country] = (regionCounts[e.country] || 0) + 1; });
  const regions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  document.getElementById("briefTop10").innerHTML = listHtml(top10);
  document.getElementById("briefCritical").innerHTML = critical.length ? listHtml(critical) : '<div class="empty-state">No critical (high severity, 3+ outlet) events right now.</div>';
  document.getElementById("briefTrending").innerHTML = trending.length
    ? trending.map(([label, n]) => `<div class="brief-region-row"><span>${escapeHtml(label)}</span><b class="mono">${n}</b></div>`).join("")
    : '<div class="empty-state">No data yet.</div>';
  document.getElementById("briefRegional").innerHTML = regions.length
    ? regions.map(([c, n]) => `<div class="brief-region-row"><span>${escapeHtml(c)}</span><b class="mono">${n}</b></div>`).join("")
    : '<div class="empty-state">No data yet.</div>';
}

function listHtml(items) {
  return items.map(ev => `
    <div class="mini-item">
      <a href="${escapeHtml(ev.primaryUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.title)}</a>
      <div class="meta">${ev.severity} \u00b7 ${escapeHtml(ev.categoryLabel)} \u00b7 ${escapeHtml(ev.country)} \u00b7 ${timeAgo(ev.publishedAt)} \u00b7 ${ev.sourceCount} outlet(s)</div>
    </div>`).join("");
}
