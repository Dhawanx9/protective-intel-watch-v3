import { getItem, setItem } from "./utils/storage.js";

/** Single source of truth for the whole app. Modules read/write through this
 *  and subscribe to changes instead of reaching into each other directly. */
class Store {
  constructor() {
    this.data = {
      events: [],
      meta: null,
      categories: [],
      loaded: false,
      loadError: null,

      filters: {
        search: "",
        categories: new Set(),   // empty set = all
        severities: new Set(),   // empty set = all
        countries: new Set(),    // empty set = all
        range: "7d",             // 24h | 48h | 72h | 7d | all
        sort: "recent"           // recent | severity | sources
      },

      feedVisiblePage: 1,
      pageSize: 20,

      settings: getItem("settings", {
        theme: "dark",
        refreshIntervalMinutes: 10,
        mapClustering: true,
        notificationsEnabled: true,
        notifyOnHighSeverity: true
      }),

      notifications: getItem("notifications", []),
      seenEventIds: new Set(getItem("seenEventIds", []))
    };
    this.listeners = new Set();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(topic) { this.listeners.forEach(fn => {
    try {fn(topic); } catch (err) { console.error("Listener error on topic", topic, err); }
  });
              }
                                                  

  setEvents(events, meta) {
    this.data.events = events;
    this.data.meta = meta;
    this.data.categories = [...new Map(events.map(e => [e.category, { id: e.category, label: e.categoryLabel, color: e.categoryColor }])).values()];
    this.data.loaded = true;
    this.emit("events");
  }

  setLoadError(err) { this.data.loadError = err; this.emit("events"); }

  updateFilters(patch) { Object.assign(this.data.filters, patch); this.data.feedVisiblePage = 1; this.emit("filters"); }
  resetFilters() {
    this.data.filters = { search: "", categories: new Set(), severities: new Set(), countries: new Set(), range: "7d", sort: "recent" };
    this.data.feedVisiblePage = 1;
    this.emit("filters");
  }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    setItem("settings", this.data.settings);
    this.emit("settings");
  }

  pushNotification(note) {
    this.data.notifications.unshift({ ...note, id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, at: new Date().toISOString() });
    this.data.notifications = this.data.notifications.slice(0, 100);
    setItem("notifications", this.data.notifications);
    this.emit("notifications");
  }
  clearNotifications() { this.data.notifications = []; setItem("notifications", []); this.emit("notifications"); }

  markSeen(ids) {
    ids.forEach(id => this.data.seenEventIds.add(id));
    setItem("seenEventIds", [...this.data.seenEventIds].slice(-2000));
  }

  /** Returns events after search/category/severity/country/range filters, before sort/pagination. */
  filteredEvents() {
    const f = this.data.filters;
    const rangeHours = { "24h": 24, "48h": 48, "72h": 72, "7d": 168, all: 24 * 365 }[f.range] ?? 168;
    const cutoff = Date.now() - rangeHours * 3600 * 1000;
    const q = f.search.trim().toLowerCase();

    let list = this.data.events.filter(e => {
      if (new Date(e.publishedAt).getTime() < cutoff) return false;
      if (f.categories.size && !f.categories.has(e.category)) return false;
      if (f.severities.size && !f.severities.has(e.severity)) return false;
      if (f.countries.size && !f.countries.has(e.country)) return false;
      if (q) {
        const hay = `${e.title} ${e.bluf} ${e.country} ${e.primaryDomain} ${e.categoryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    if (f.sort === "recent") list = list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    else if (f.sort === "severity") list = list.sort((a, b) => rank[b.severity] - rank[a.severity] || new Date(b.publishedAt) - new Date(a.publishedAt));
    else if (f.sort === "sources") list = list.sort((a, b) => b.sourceCount - a.sourceCount || new Date(b.publishedAt) - new Date(a.publishedAt));

    return list;
  }
}

export const store = new Store();
