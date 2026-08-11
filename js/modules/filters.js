import { store } from "../state.js";
import { el, escapeHtml, debounce } from "../utils/dom.js";
import { navigateTo } from "../router.js";
import { ALL_REGIONS } from "../utils/regions.js";

const RANGES = [
  { id: "24h", label: "Last 24h" }, { id: "48h", label: "Last 48h" },
  { id: "72h", label: "Last 72h" }, { id: "7d", label: "Last 7d" }, { id: "all", label: "All time" }
];
const SORTS = [
  { id: "recent", label: "Sort: Most recent" }, { id: "severity", label: "Sort: Severity" }, { id: "sources", label: "Sort: Most sources" }
];
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"];

// Category and severity moved from multi-select toggle chips to single-select
// dropdowns - this is what guarantees only one thing is ever "selected" at a
// time across the whole filter bar (a <select> can only show one chosen
// value, so there's no possibility of two options both looking active, or
// of a previous selection staying visually highlighted after picking a new
// one - the exact bug this replaces).
export function initFilters() {
  buildCategorySelect();
  buildSeveritySelect();
  buildRegionSelect();
  buildRangeSelect();
  buildSortSelect();
  buildSidebarCategoryList();
  bindSearch();
  document.getElementById("resetFiltersBtn").addEventListener("click", () => {
    store.resetFilters();
    document.getElementById("globalSearchInput").value = "";
    syncSelectsToFilters();
  });
  store.subscribe(topic => {
    if (topic === "events") { buildCategorySelect(); buildCountryChips(); buildSidebarCategoryList(); }
    if (topic === "filters") { syncSelectsToFilters(); buildSidebarCategoryList(); }
  });
}

/** Keeps every dropdown's displayed value in sync with the actual filter
 *  state, regardless of what triggered the change - a dropdown pick, the
 *  Reset button, a sidebar category click, or a chart drill-down. This is
 *  what prevents any dropdown from silently showing a stale selection. */
function syncSelectsToFilters() {
  const f = store.data.filters;
  const catSelect = document.getElementById("categorySelect");
  if (catSelect) catSelect.value = f.categories.size ? [...f.categories][0] : "";
  const sevSelect = document.getElementById("severitySelect");
  if (sevSelect) sevSelect.value = f.severities.size ? [...f.severities][0] : "";
  const regionSelect = document.getElementById("regionSelect");
  if (regionSelect) regionSelect.value = f.regions.size ? [...f.regions][0] : "";
  const countrySelect = document.getElementById("countrySelect");
  if (countrySelect) countrySelect.value = f.countries.size ? [...f.countries][0] : "";
}

function buildSidebarCategoryList() {
  const root = document.getElementById("sidebarCategoryList");
  if (!root) return;
  root.innerHTML = "";
  store.data.categories.forEach(cat => {
    const count = store.data.events.filter(e => e.category === cat.id).length;
    const isActive = store.data.filters.categories.size === 1 && store.data.filters.categories.has(cat.id);
    const row = el("div", { class: `nav-item${isActive ? " active" : ""}` }, [
      el("span", { style: `display:inline-block;width:8px;height:8px;border-radius:2px;background:${cat.color};flex-shrink:0;` }),
      cat.label,
      el("span", { class: "count" }, String(count))
    ]);
    row.addEventListener("click", () => {
      store.updateFilters({ categories: new Set([cat.id]) });
      navigateTo("feed");
    });
    root.appendChild(row);
  });
}

function buildCategorySelect() {
  const root = document.getElementById("categorySelect");
  if (!root) return;
  const current = store.data.filters.categories.size ? [...store.data.filters.categories][0] : "";
  root.innerHTML = `<option value="">All categories</option>` +
    store.data.categories.map(c => `<option value="${escapeHtml(c.id)}" ${current === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("");
  root.onchange = () => {
    store.updateFilters({ categories: root.value ? new Set([root.value]) : new Set() });
  };
}

function buildSeveritySelect() {
  const root = document.getElementById("severitySelect");
  if (!root) return;
  const current = store.data.filters.severities.size ? [...store.data.filters.severities][0] : "";
  root.innerHTML = `<option value="">All severities</option>` +
    SEVERITIES.map(s => `<option value="${s}" ${current === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`).join("");
  root.onchange = () => {
    store.updateFilters({ severities: root.value ? new Set([root.value]) : new Set() });
  };
}

function buildRegionSelect() {
  const root = document.getElementById("regionSelect");
  if (!root) return;
  const current = store.data.filters.regions.size ? [...store.data.filters.regions][0] : "";
  root.innerHTML = `<option value="">All regions</option>` +
    ALL_REGIONS.map(r => `<option value="${escapeHtml(r)}" ${current === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("");
  root.onchange = () => {
    store.updateFilters({ regions: root.value ? new Set([root.value]) : new Set() });
  };
}

function buildCountryChips() {
  const root = document.getElementById("countrySelect");
  if (!root) return;
  const countries = [...new Set(store.data.events.map(e => e.country).filter(c => c && c !== "Unknown"))].sort();
  root.innerHTML = `<option value="">All countries</option>` + countries.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  root.onchange = () => {
    const set = new Set();
    if (root.value) set.add(root.value);
    store.updateFilters({ countries: set });
  };
}

function buildRangeSelect() {
  const root = document.getElementById("rangeSelect");
  if (!root) return;
  root.innerHTML = RANGES.map(r => `<option value="${r.id}" ${store.data.filters.range === r.id ? "selected" : ""}>${r.label}</option>`).join("");
  root.onchange = () => store.updateFilters({ range: root.value });
}

function buildSortSelect() {
  const root = document.getElementById("sortSelect");
  if (!root) return;
  root.innerHTML = SORTS.map(s => `<option value="${s.id}" ${store.data.filters.sort === s.id ? "selected" : ""}>${s.label}</option>`).join("");
  root.onchange = () => store.updateFilters({ sort: root.value });
}

function bindSearch() {
  const input = document.getElementById("globalSearchInput");
  if (!input) return;
  input.addEventListener("input", debounce(() => store.updateFilters({ search: input.value }), 150));
}

export function refreshFilterUI() {
  buildCategorySelect();
  buildSeveritySelect();
  buildRegionSelect();
}
