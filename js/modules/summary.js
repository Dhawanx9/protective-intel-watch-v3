import { store } from "../state.js";
import { formatClock, timeAgo } from "../utils/time.js";
import { escapeHtml } from "../utils/dom.js";

export function initSummary() {
  render();
  store.subscribe(topic => { if (topic === "events" || topic === "filters") render(); });
}

function render() {
  if (!store.data.loaded) return;
  const events = store.data.events;
  const high = events.filter(e => e.severity === "HIGH");
  const critical = high.filter(e => e.sourceCount >= 3);
  const facilities = new Set(events.filter(e => e.category === "facility_threats").map(e => e.primaryDomain)).size;
  const countries = new Set(events.map(e => e.country).filter(c => c && c !== "Unknown")).size;

  setVal("statTotalThreats", events.length);
  setVal("statHighSeverity", high.length);
  setVal("statCritical", critical.length);
  setVal("statFacilities", facilities);
  setVal("statCountries", countries);
  setVal("statLastUpdate", store.data.meta ? formatClock(new Date(store.data.meta.generatedAt)) : "--:--:--");

  renderRecentHigh(high);
  renderCategorySnapshot(events);
}

function renderRecentHigh(high) {
  const root = document.getElementById("dashboardRecentHigh");
  if (!root) return;
  const recent = [...high].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 6);
  root.innerHTML = recent.length
    ? recent.map(ev => `
      <div class="mini-item">
        <a href="${escapeHtml(ev.primaryUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.title)}</a>
        <div class="meta">${timeAgo(ev.publishedAt)} \u00b7 ${escapeHtml(ev.categoryLabel)} \u00b7 ${escapeHtml(ev.country)}</div>
      </div>`).join("")
    : '<div class="empty-state">No high-severity events right now.</div>';
}

function renderCategorySnapshot(events) {
  const root = document.getElementById("dashboardCategorySnapshot");
  if (!root) return;
  const counts = {};
  events.forEach(e => { counts[e.category] = counts[e.category] || { label: e.categoryLabel, color: e.categoryColor, n: 0 }; counts[e.category].n++; });
  const rows = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 6);
  const max = Math.max(1, ...rows.map(r => r.n));
  root.innerHTML = rows.length ? rows.map(r => `
    <div class="bar-row"><span class="name">${escapeHtml(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(0)}%;background:${r.color}"></div></div>
      <span class="num">${r.n}</span></div>`).join("") : '<div class="empty-state">No data yet.</div>';
}

function setVal(id, val) {
  const node = document.getElementById(id);
  if (node) node.textContent = val;
}
