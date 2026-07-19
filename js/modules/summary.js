import { store } from "../state.js";
import { formatClock, timeAgo } from "../utils/time.js";
import { escapeHtml } from "../utils/dom.js";
import { drawLineChart, getCss, attachLineChartTooltip } from "./analytics.js";
import { drillDownTo } from "../utils/drilldown.js";

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
  renderWeeklyTrend(events);
  renderTopCountries(events);
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
  const rows = Object.entries(counts).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.n - a.n).slice(0, 6);
  const max = Math.max(1, ...rows.map(r => r.n));
  root.innerHTML = rows.length ? rows.map(r => `
    <div class="bar-row" data-drill-category="${escapeHtml(r.id)}" style="cursor:pointer;" title="${r.n} ${escapeHtml(r.label)} event${r.n === 1 ? "" : "s"} (last 90 days) - click to view them">
      <span class="name">${escapeHtml(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(0)}%;background:${r.color}"></div></div>
      <span class="num">${r.n}</span></div>`).join("") : '<div class="empty-state">No data yet.</div>';

  root.querySelectorAll("[data-drill-category]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({ category: rowEl.getAttribute("data-drill-category") }));
  });
}

/** 7-day activity trend, same rendering approach as the 14-day chart on the
 *  Analytics tab (reuses drawLineChart + attachLineChartTooltip from
 *  analytics.js) but scoped shorter since this is meant as an at-a-glance
 *  summary, not the detailed view. Hover shows the exact date and count -
 *  a line with no way to read its values is decoration, not data. */
function renderWeeklyTrend(events) {
  const canvas = document.getElementById("dashboardTrendChart");
  if (!canvas) return;
  const days = 7;
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - i));
    return { date: d, count: 0 };
  });
  events.forEach(e => {
    const d = new Date(e.publishedAt); d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.date.getTime() === d.getTime());
    if (bucket) bucket.count++;
  });
  drawLineChart(canvas, buckets.map(b => b.count));
  attachLineChartTooltip(canvas, buckets);

  const labelRoot = document.getElementById("dashboardTrendLabels");
  if (labelRoot) {
    labelRoot.innerHTML = buckets.map(b =>
      `<span>${b.date.toLocaleDateString(undefined, { weekday: "short" })}</span>`
    ).join("");
  }
}

/** Top 5 countries by event count, same data/logic as the Analytics tab's
 *  "Threats by Country" bars, just trimmed to fit the summary panel. */
function renderTopCountries(events) {
  const root = document.getElementById("dashboardTopCountries");
  if (!root) return;
  const counts = {};
  events.forEach(e => { if (e.country && e.country !== "Unknown") counts[e.country] = (counts[e.country] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...rows.map(r => r[1]));
  root.innerHTML = rows.length ? rows.map(([c, n]) => `
    <div class="bar-row" data-drill-country="${escapeHtml(c)}" style="cursor:pointer;" title="${n} event${n === 1 ? "" : "s"} in ${escapeHtml(c)} (last 90 days) - click to view them">
      <span class="name">${escapeHtml(c)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${getCss("--accent")}"></div></div>
      <span class="num">${n}</span></div>`).join("") : '<div class="empty-state">No country data yet.</div>';

  root.querySelectorAll("[data-drill-country]").forEach(rowEl => {
    rowEl.addEventListener("click", () => drillDownTo({ country: rowEl.getAttribute("data-drill-country") }));
  });
}

function setVal(id, val) {
  const node = document.getElementById(id);
  if (node) node.textContent = val;
}
