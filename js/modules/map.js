import { store } from "../state.js";
import { escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";

let map = null;
let clusterGroup = null;
let initialized = false;

export function initMap() {
  document.getElementById("mapRefreshBtn").addEventListener("click", render);
  store.subscribe(topic => {
    if (topic === "events" && document.getElementById("view-map").classList.contains("active")) render();
  });
}

export function onMapViewShown() {
  ensureMap();
  render();
  setTimeout(() => map.invalidateSize(), 50);
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

function render() {
  if (!initialized) return;
  clusterGroup.clearLayers();
  const events = store.filteredEvents().filter(e => e.lat != null && e.lon != null);

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
