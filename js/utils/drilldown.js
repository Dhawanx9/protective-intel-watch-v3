import { store } from "../state.js";
import { navigateTo } from "../router.js";

/** Navigates to Live Feed pre-filtered to exactly one slice - a category, a
 *  severity, a country, or a source/outlet. Used by every clickable chart
 *  across Executive Summary and Analytics, so a number on a bar is never
 *  just decoration - clicking it always takes you straight to those exact
 *  events.
 *
 *  Always widens the time range to "all" first: these charts summarize the
 *  full loaded dataset (up to 90 days), not whatever narrower time range
 *  Live Feed happened to have active - without this, clicking a bar could
 *  land on a page showing "0 events" even though the bar clearly said 44. */
export function drillDownTo({ category, severity, country, source } = {}) {
  store.updateFilters({
    range: "all",
    search: "",
    categories: category ? new Set([category]) : new Set(),
    severities: severity ? new Set([severity]) : new Set(),
    countries: country ? new Set([country]) : new Set(),
    sources: source ? new Set([source]) : new Set(),
  });
  navigateTo("feed");
}
