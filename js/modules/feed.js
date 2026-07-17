import { store } from "../state.js";
import { el, escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";

let sentinelObserver = null;

export function initFeed() {
  render();
  store.subscribe(topic => { if (topic === "events" || topic === "filters") render(); });
}

function render() {
  const root = document.getElementById("feedRoot");
  const countEl = document.getElementById("feedCount");
  if (!root) return;

  if (store.data.loadError) {
    root.innerHTML = `<div class="error-state"><b>Could not load intelligence data.</b><br>${escapeHtml(store.data.loadError)}<br><br>If this is a fresh deployment, the pipeline hasn't run yet - check the Actions tab, or run <code>npm run build</code> locally to generate data/latest.json.</div>`;
    return;
  }
  if (!store.data.loaded) {
    root.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="event-card"><div><div class="skeleton" style="height:12px;width:30%;margin-bottom:10px;"></div>
      <div class="skeleton" style="height:18px;width:80%;margin-bottom:8px;"></div>
      <div class="skeleton" style="height:12px;width:60%;"></div></div></div>`).join("");
    return;
  }

  const all = store.filteredEvents();
  const pageSize = store.data.pageSize;
  const visibleCount = Math.min(all.length, store.data.feedVisiblePage * pageSize);
  const visible = all.slice(0, visibleCount);

  countEl.textContent = `${all.length} event${all.length === 1 ? "" : "s"}`;

  if (!all.length) {
    root.innerHTML = '<div class="empty-state">No events match the current filters. Widen the time range or clear a filter.</div>';
    return;
  }

  root.innerHTML = visible.map(cardHtml).join("") +
    (visibleCount < all.length ? `<button class="btn load-more-btn" id="loadMoreBtn">Load more (${all.length - visibleCount} remaining)</button>` : "");

  root.querySelectorAll("[data-toggle-sources]").forEach(elm => {
    elm.addEventListener("click", () => {
      const list = elm.closest(".event-card").querySelector(".event-sources-list");
      list.classList.toggle("open");
      elm.textContent = list.classList.contains("open")
        ? elm.textContent.replace("\u25bc", "\u25b2")
        : elm.textContent.replace("\u25b2", "\u25bc");
    });
  });

  const loadMore = document.getElementById("loadMoreBtn");
  if (loadMore) loadMore.addEventListener("click", () => {
    store.data.feedVisiblePage += 1;
    render();
  });

  attachInfiniteScroll(visibleCount < all.length);
}

function cardHtml(ev) {
  const sevClass = ev.severity.toLowerCase();
  const otherSources = ev.sources.slice(1);
  return `
  <article class="event-card">
    <div>
      <div class="event-tags">
        <span class="badge ${sevClass}">${ev.severity}</span>
        <span class="chip" style="color:${ev.categoryColor}; border-color:${ev.categoryColor}66;">${escapeHtml(ev.categoryLabel)}</span>
      </div>
      <h3><a href="${escapeHtml(ev.primaryUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.title)}</a></h3>
      <p class="event-bluf">${escapeHtml(ev.bluf)}</p>
      <div class="event-meta">
        <span>${timeAgo(ev.publishedAt)}</span>
        <span><b>${escapeHtml(ev.country)}</b></span>
        <span><b>${escapeHtml(ev.primaryDomain)}</b></span>
        ${ev.sourceCount > 1 ? `<span class="event-sources-toggle" data-toggle-sources>${ev.sourceCount} outlets \u25bc</span>` : ""}
      </div>
      ${otherSources.length ? `<div class="event-sources-list">${otherSources.map(s => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.domain)} \u2014 ${timeAgo(s.publishedAt)}</a>`).join("")}</div>` : ""}
    </div>
    <div class="event-actions">
      <a class="btn small primary open-btn" href="${escapeHtml(ev.primaryUrl)}" target="_blank" rel="noopener noreferrer">Open article</a>
    </div>
  </article>`;
}

function attachInfiniteScroll(hasMore) {
  if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
  if (!hasMore) return;
  const root = document.getElementById("feedRoot");
  const sentinel = el("div", { class: "load-more-sentinel" });
  root.appendChild(sentinel);
  sentinelObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      store.data.feedVisiblePage += 1;
      render();
    }
  }, { rootMargin: "200px" });
  sentinelObserver.observe(sentinel);
}
