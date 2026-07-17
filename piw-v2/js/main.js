import { store } from "./state.js";
import { loadIntelligenceData } from "./api.js";
import { initRouter, navigateTo } from "./router.js";
import { initTheme } from "./modules/theme.js";
import { initSummary } from "./modules/summary.js";
import { initFeed } from "./modules/feed.js";
import { initFilters } from "./modules/filters.js";
import { initMap, onMapViewShown } from "./modules/map.js";
import { initAnalytics } from "./modules/analytics.js";
import { initNotifications, notify } from "./modules/notifications.js";
import { initFeedManager } from "./modules/feedManager.js";
import { initBrief } from "./modules/brief.js";
import { initSettings } from "./modules/settings.js";
import { formatClock } from "./utils/time.js";

let refreshTimer = null;
let previousEventIds = new Set();

function tickClock() {
  const el = document.getElementById("clockNow");
  if (el) el.textContent = formatClock();
}

async function loadData({ isRefresh = false } = {}) {
  try {
    const { events, meta } = await loadIntelligenceData();

    if (isRefresh && previousEventIds.size) {
      const newOnes = events.filter(e => !previousEventIds.has(e.id));
      if (newOnes.length && store.data.settings.notificationsEnabled) {
        const highNew = newOnes.filter(e => e.severity === "HIGH");
        const toAnnounce = store.data.settings.notifyOnHighSeverity ? highNew : newOnes;
        toAnnounce.slice(0, 5).forEach(ev => notify({
          message: `${ev.severity}: ${ev.title}`,
          severity: ev.severity,
          link: ev.primaryUrl
        }));
      }
      events.forEach(e => { e.isNew = !previousEventIds.has(e.id); });
    }

    previousEventIds = new Set(events.map(e => e.id));
    store.setEvents(events, meta);
    const banner = document.getElementById("sampleDataBanner");
    if (banner) banner.style.display = meta?.isSampleData ? "block" : "none";
  } catch (err) {
    store.setLoadError(err.message);
  }
}

function scheduleRefresh(minutes) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadData({ isRefresh: true }), minutes * 60 * 1000);
}

function bindManualRefresh() {
  document.getElementById("refreshNowBtn").addEventListener("click", async () => {
    const btn = document.getElementById("refreshNowBtn");
    btn.textContent = "Refreshing\u2026";
    await loadData({ isRefresh: true });
    btn.textContent = "Refresh now";
  });
}

async function main() {
  initTheme();
  initRouter({
    onChange: (view) => { if (view === "map") onMapViewShown(); }
  });
  initFilters();
  initSummary();
  initFeed();
  initMap();
  initAnalytics();
  initNotifications();
  initFeedManager({ getFeedHealth: () => store.data.meta?.feedHealth || [] });
  initBrief();
  initSettings({ onRefreshIntervalChange: scheduleRefresh });
  bindManualRefresh();

  setInterval(tickClock, 1000);
  tickClock();

  await loadData();
  scheduleRefresh(store.data.settings.refreshIntervalMinutes);
}

main();
