import { store } from "./state.js";
import { loadIntelligenceData } from "./api.js";
import { initRouter, navigateTo } from "./router.js";
import { initTheme } from "./modules/theme.js";
import { initSummary } from "./modules/summary.js";
import { initFeed } from "./modules/feed.js";
import { initFilters } from "./modules/filters.js";
import { initMap, onMapViewShown } from "./modules/map.js";
import { initAnalytics, onAnalyticsViewShown } from "./modules/analytics.js";
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

function initScrollTop() {
  const btn = document.getElementById("scrollTopBtn");
  if (!btn) return;
  window.addEventListener("scroll", () => {
    const show = window.scrollY > 400;
    btn.style.opacity = show ? "1" : "0";
    btn.style.pointerEvents = show ? "auto" : "none";
  });
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/** The global search box only actually filters something on the Live Feed
 *  view - on every other view (Executive Summary, Map, Analytics, Daily
 *  Brief, Feed Manager, Settings) typing into it does nothing, which is
 *  confusing. Hide it everywhere except Live Feed instead of showing a
 *  non-functional input on every page. */
function toggleSearchBoxVisibility(view) {
  const box = document.querySelector(".search-box");
  if (!box) return;
  box.style.display = view === "feed" ? "" : "none";
}

async function main() {
  initTheme();
  toggleSearchBoxVisibility("dashboard"); // matches the default active view in index.html
  initRouter({
    onChange: (view) => {
      if (view === "map") onMapViewShown();
      if (view === "analytics") onAnalyticsViewShown();
      toggleSearchBoxVisibility(view);
    }
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
  initScrollTop();
  setInterval(tickClock, 1000);
  tickClock();
  await loadData();
  scheduleRefresh(store.data.settings.refreshIntervalMinutes);
}

main();
