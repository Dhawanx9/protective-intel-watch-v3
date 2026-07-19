import { store } from "../state.js";
import { el, escapeHtml, debounce } from "../utils/dom.js";
import { navigateTo } from "../router.js";

const RANGES = [
  { id: "24h", label: "Last 24h" }, { id: "48h", label: "Last 48h" },
  { id: "72h", label: "Last 72h" }, { id: "7d", label: "Last 7d" }, { id: "all", label: "All time" }
];
const SORTS = [
  { id: "recent", label: "Sort: Most recent" }, { id: "severity", label: "Sort: Severity" }, { id: "sources", label: "Sort: Most sources" }
];
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"];

export function initFilters() {
  buildCategoryChips();
  buildSeverityChips();
  buildRangeSelect();
  buildSortSelect();
  buildSidebarCategoryList();
  bindSearch();
  document.getElementById("resetFiltersBtn").addEventListener("click", () => {
    store.resetFilters();
    document.getElementById("globalSearchInput").value = "";
  });
  // Rebuilding on "events" alone meant clicking a chip updated the actual
  // filter (so the feed list itself did filter correctly) but the chip's
  // own highlighted/"on" state never got redrawn afterward - it just sat
  // there looking unclicked forever, since nothing told it to re-check
  // itself against the current filter state. Also rebuilding on "filters"
  // fixes that, AND makes the Reset filters button and sidebar category
  // clicks correctly clear/update every chip's visual state too, not just
  // the underlying data.
  store.subscribe(topic => {
    if (topic === "events") { buildCategoryChips(); buildCountryChips(); buildSidebarCategoryList(); }
    if (topic === "filters") { buildCategoryChips(); buildSeverityChips(); }
  });
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

function buildCategoryChips() {
  const root = document.getElementById("categoryChips");
  if (!root) return;
  root.innerHTML = "";
  store.data.categories.forEach(cat => {
    const on = store.data.filters.categories.has(cat.id);
    const chip = el("span", { class: `chip${on ? " on" : ""}` }, [
      el("span", { class: "dot", style: `background:${cat.color}` }),
      cat.label
    ]);
    chip.addEventListener("click", () => {
      const set = store.data.filters.categories;
      set.has(cat.id) ? set.delete(cat.id) : set.add(cat.id);
      // Toggle this chip's own visual state immediately, synchronously -
      // don't wait for the store subscription round-trip, so the click
      // feels instant rather than possibly-delayed.
      chip.classList.toggle("on");
      store.updateFilters({ categories: set });
    });
    root.appendChild(chip);
  });
}

function buildSeverityChips() {
  const root = document.getElementById("severityChips");
  if (!root) return;
  root.innerHTML = "";
  SEVERITIES.forEach(sev => {
    const on = store.data.filters.severities.has(sev);
    const chip = el("span", { class: `chip${on ? " on" : ""}` }, sev);
    chip.addEventListener("click", () => {
      const set = store.data.filters.severities;
      set.has(sev) ? set.delete(sev) : set.add(sev);
      chip.classList.toggle("on");
      store.updateFilters({ severities: set });
    });
    root.appendChild(chip);
  });
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
  buildCategoryChips();
  buildSeverityChips();
}
