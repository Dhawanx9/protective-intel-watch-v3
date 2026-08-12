import { store } from "../state.js";
import { escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";

let map = null;
let clusterGroup = null;
let initialized = false;

// The Map view deliberately does NOT share the global filter state used by
// the sidebar categories, Live Feed, and Analytics - it has its own local
// filters instead, tracked here. Previously render() called
// store.filteredEvents(), which reads from the SAME shared store.data.filters
// that sidebar category clicks write to - so clicking a category anywhere
// else in the app silently changed what the map showed too, even though
// the map is meant to be an independent situational view. mapFilters below
// is a completely separate piece of state, and getMapEvents() reads from
// the raw, unfiltered store.data.events directly instead of going through
// store.filteredEvents() at all.
let mapFilters = {
  category: "",   // "" = all categories
  severity: "",   // "" = all severities
  range: "7d"     // 24h | 48h | 72h | 7d | all
};

export function initMap() {
  document.getElementById("mapRefreshBtn").addEventListener("click", render);

  populateMapCategoryOptions();
  bindMapFilters();

  store.subscribe(topic => {
    if (topic === "events") {
      populateMapCategoryOptions();
      if (document.getElementById("view-map").classList.contains("active")) render();
    }
  });
}

export function onMapViewShown() {
  ensureMap();
  render();
  setTimeout(() => map.invalidateSize(), 50);
}

/** Category dropdown options come from the full category list (so a
 *  category with zero current events still appears), same source the
 *  sidebar uses - but selecting one here only affects mapFilters, not the
 *  shared store.data.filters the sidebar itself writes to. */
function populateMapCategoryOptions() {
  const catSelect = document.getElementById("mapCategorySelect");
  if (!catSelect) return;
  const current = mapFilters.category;
  catSelect.innerHTML = `<option value="">All categories</option>` +
    store.data.categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("");
  catSelect.value = current;
}

function bindMapFilters() {
  const catSelect = document.getElementById("mapCategorySelect");
  const sevSelect = document.getElementById("mapSeveritySelect");
  const rangeSelect = document.getElementById("mapRangeSelect");
  const resetBtn = document.getElementById("mapResetFiltersBtn");

  if (catSelect) catSelect.addEventListener("change", () => { mapFilters.category = catSelect.value; render(); });
  if (sevSelect) sevSelect.addEventListener("change", () => { mapFilters.severity = sevSelect.value; render(); });
  if (rangeSelect) rangeSelect.addEventListener("change", () => { mapFilters.range = rangeSelect.value; render(); });
  if (resetBtn) resetBtn.addEventListener("click", () => {
    mapFilters = { category: "", severity: "", range: "7d" };
    if (catSelect) catSelect.value = "";
    if (sevSelect) sevSelect.value = "";
    if (rangeSelect) rangeSelect.value = "7d";
    render();
  });
}

function ensureMap() {
  if (initialized) return;
  map = L.map("mapCanvas", { worldCopyJump: true }).setView([20, 10], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 18
  }).addTo(map);
  clusterGroup = L.markerClusterGroup({
    iconCreateFunction: cluster => L.divIcon({
      html: `<div class="marker-cluster-piw" style="width:38px;height:38px;">${cluster.getChildCount()}</div>`,
      className: "", iconSize: [38, 38]
    })
  });
  map.addLayer(clusterGroup);
  initialized = true;
}

function severityColor(sev) {
  return sev === "HIGH" ? getCss("--high") : sev === "MEDIUM" ? getCss("--medium") : getCss("--low");
}
function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

/** The map's own independent filtering, applied directly to the full raw
 *  event list (store.data.events) - deliberately bypasses
 *  store.filteredEvents() and the shared store.data.filters entirely, so
 *  nothing selected elsewhere in the app (sidebar categories, Live Feed
 *  filters, Analytics) has any effect here. Only mapFilters, set via the
 *  dropdowns in the Map view itself, controls what shows on the map. */
function getMapEvents() {
  const rangeHours = { "24h": 24, "48h": 48, "72h": 72, "7d": 168, all: 24 * 365 }[mapFilters.range] ?? 168;
  const cutoff = Date.now() - rangeHours * 3600 * 1000;

  return store.data.events.filter(e => {
    if (e.lat == null || e.lon == null) return false;
    if (new Date(e.publishedAt).getTime() < cutoff) return false;
    if (mapFilters.category && e.category !== mapFilters.category) return false;
    if (mapFilters.severity && e.severity !== mapFilters.severity) return false;
    return true;
  });
}

function render() {
  if (!initialized) return;
  clusterGroup.clearLayers();
  const events = getMapEvents();
  events.forEach(ev => {
    const marker = L.circleMarker([ev.lat, ev.lon], {
      radius: 7, color: severityColor(ev.severity), fillColor: severityColor(ev.severity), fillOpacity: 0.75, weight: 1.5
    });
    marker.bindPopup(`
      <div class="map-popup">
        <div class="cat">${escapeHtml(ev.categoryLabel)} \u00b7 ${ev.severity}</div>
        <h4>${escapeHtml(ev.title)}</h4>
        <div>${escapeHtml(ev.country)} \u00b7 ${timeAgo(ev.publishedAt)}</div>
        <a class="open-link" href="${escapeHtml(ev.primaryUrl)}" target="_blank" rel="noopener noreferrer">Open original article \u2192</a>
      </div>`);
    clusterGroup.addLayer(marker);
  });
  document.getElementById("mapRefreshBtn").textContent = events.length ? `Refresh map (${events.length} events)` : "Refresh map (no located events in window)";
}
