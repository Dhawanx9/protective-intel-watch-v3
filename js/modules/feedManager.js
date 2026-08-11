import { escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";
import { parseOPML, toOPML, downloadTextFile } from "../utils/opml.js";
import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import { store } from "../state.js";
import { notify } from "./notifications.js";

let feedHealthByLabelGetter = null;
let currentFeeds = [];
let pendingChecks = new Set(); // feed ids added this session, awaiting their first health report

// Pagination - shows a fixed page of rows instead of scrolling or letting
// the panel stretch to fit everything at once. PAGE_SIZE is tuned to fit
// comfortably inside the panel-body's 640px cap (see dashboard.css).
const PAGE_SIZE = 8;
let currentPage = 1;

// Icon-only action buttons instead of text labels - matches the icon style
// already used for the theme toggle and logout button elsewhere in the app
// (stroke-based, 24x24 viewBox). Each has a title/aria-label for a hover
// tooltip and screen readers, since removing the text label means the
// icon alone has to carry the meaning.
const ICON_TEST = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;
const ICON_EDIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

export function initFeedManager({ getFeedHealth }) {
  feedHealthByLabelGetter = getFeedHealth;

  if (!isSupabaseConfigured()) {
    document.getElementById("feedManagerBody").innerHTML =
      `<div class="error-state">Supabase isn't configured yet. Fill in <code>js/supabaseConfig.js</code> with your project URL and anon key, and run <code>supabase/schema.sql</code> in your Supabase SQL editor first.</div>`;
    return;
  }

  bindFeedForm();
  bindOPML();
  loadFeeds();

  supabase
    .channel("feeds-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "feeds" }, () => loadFeeds())
    .subscribe();

  // Keeps the health column live whenever the pipeline refreshes data in the
  // background - previously this only rendered once, on first load. Also
  // checks whether any newly-added feed has reported back yet.
  store.subscribe(topic => {
    if (topic === "events") {
      renderTable(currentFeeds);
      checkPendingFeeds();
    }
  });
}

async function loadFeeds() {
  const { data, error } = await supabase.from("feeds").select("*").order("label");
  const tbody = document.getElementById("feedRows");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="error-state">Couldn't load feeds from Supabase: ${escapeHtml(error.message)}</div></td></tr>`;
    return;
  }
  currentFeeds = data || [];
  renderTable(currentFeeds);
}

function renderTable(feeds) {
  const tbody = document.getElementById("feedRows");
  const health = feedHealthByLabelGetter ? feedHealthByLabelGetter() : [];

  const totalPages = Math.max(1, Math.ceil(feeds.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageFeeds = feeds.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageFeeds.length ? pageFeeds.map(f => {
    const h = health.find(x => x.id === f.id);
    const statusClass = !f.enabled ? "disabled" : h?.status === "ok" ? "ok" : h?.status === "error" ? "err" : "disabled";
    const statusLabel = !f.enabled ? "Disabled" : h?.status === "ok" ? "Healthy" : h?.status === "error" ? "Error" : "Pending next run";
    const lastPull = h?.checkedAt ? timeAgo(h.checkedAt) : "\u2014";
    const count = h?.count ?? "\u2014";
    const errTitle = h?.error ? ` title="${escapeHtml(h.error)}"` : "";
    const errorLine = (h?.status === "error" && h?.error)
      ? `<div style="font-size:10.5px;color:var(--high);margin-top:3px;">${escapeHtml(h.error)}</div>`
      : "";
    return `<tr data-id="${escapeHtml(f.id)}">
      <td${errTitle}><span class="status-dot ${statusClass}"></span>${statusLabel}</td>
      <td>
        <div><b>${escapeHtml(f.label)}</b></div>
        <div class="mono" title="${escapeHtml(f.url)}" style="font-size:10.5px;color:var(--text-faint);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.url)}</div>
        ${errorLine}
      </td>
      <td class="mono">${lastPull}</td>
      <td class="mono">${count}</td>
      <td><div class="toggle${f.enabled ? " on" : ""}" data-toggle></div></td>
      <td class="row-actions">
        <button class="btn small" data-test title="Test now" aria-label="Test now">${ICON_TEST}</button>
        <button class="btn small" data-edit title="Edit" aria-label="Edit">${ICON_EDIT}</button>
        <button class="btn small danger" data-remove title="Delete" aria-label="Delete">${ICON_DELETE}</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty-state">No feeds yet. Add one on the right.</div></td></tr>`;

  tbody.querySelectorAll("[data-toggle]").forEach(t => t.addEventListener("click", async () => {
    const row = t.closest("tr");
    const id = row.getAttribute("data-id");
    const feed = feeds.find(f => f.id === id);
    const { error } = await supabase.from("feeds").update({ enabled: !feed.enabled }).eq("id", id);
    if (error) alert("Couldn't update: " + error.message);
    else loadFeeds();
  }));

  tbody.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
    const row = b.closest("tr");
    const id = row.getAttribute("data-id");
    if (!confirm(`Delete feed "${id}"? This can't be undone.`)) return;
    const { error } = await supabase.from("feeds").delete().eq("id", id);
    if (error) alert("Couldn't delete: " + error.message);
    else loadFeeds();
  }));

  tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const row = b.closest("tr");
    const id = row.getAttribute("data-id");
    const feed = feeds.find(f => f.id === id);
    document.getElementById("newFeedLabel").value = feed.label;
    document.getElementById("newFeedUrl").value = feed.url;
    document.getElementById("newFeedRegion").value = feed.region;
    document.getElementById("addFeedBtn").textContent = "Save changes";
    document.getElementById("addFeedBtn").setAttribute("data-editing-id", id);
  }));

  tbody.querySelectorAll("[data-test]").forEach(b => b.addEventListener("click", () => {
    const row = b.closest("tr");
    const id = row.getAttribute("data-id");
    const feed = feeds.find(f => f.id === id);
    testFeedNow(feed, b);
  }));

  renderPagination(feeds.length, totalPages);
}

/** Numbered pagination controls under the table - Prev / 1 2 3 ... / Next.
 *  Keeps the panel at a fixed, predictable height regardless of how many
 *  feeds exist (4 or 400), instead of scrolling or growing the panel. */
function renderPagination(totalFeeds, totalPages) {
  const container = document.getElementById("feedPagination");
  if (!container) return;

  if (totalFeeds === 0 || totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalFeeds);

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="btn small${p === currentPage ? " primary" : ""}" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`;
  }

  container.innerHTML = `
    <div class="pagination">
      <span class="pagination-range mono">${start}\u2013${end} of ${totalFeeds}</span>
      <div class="pagination-buttons">
        <button class="btn small" data-page="prev" ${currentPage === 1 ? "disabled" : ""}>\u2039 Prev</button>
        ${pageButtons}
        <button class="btn small" data-page="next" ${currentPage === totalPages ? "disabled" : ""}>Next \u203a</button>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-page");
      if (val === "prev") currentPage = Math.max(1, currentPage - 1);
      else if (val === "next") currentPage = Math.min(totalPages, currentPage + 1);
      else currentPage = parseInt(val, 10);
      renderTable(currentFeeds);
    });
  });
}

/** Instant, on-demand feed check - calls the "test-feed" Supabase Edge Function
 *  so the browser never hits the target RSS URL directly (avoids CORS), and the
 *  user gets a pass/fail toast in seconds instead of waiting for the next
 *  10-minute pipeline run. */
async function testFeedNow(feed, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = "0.5";

  try {
    const { data, error } = await supabase.functions.invoke("test-feed", {
      body: { url: feed.url },
    });

    if (error) throw error;

    if (data?.ok) {
      notify({
        message: `${feed.label}: \u2713 ${data.itemCount} item(s) found. Latest: "${data.firstTitle || "\u2014"}"`,
        severity: "LOW",
      });
    } else {
      notify({
        message: `${feed.label}: \u2717 ${data?.error || "Unknown error"}`,
        severity: "HIGH",
      });
    }
  } catch (err) {
    notify({
      message: `${feed.label}: couldn't reach the test service (${err.message || err}).`,
      severity: "HIGH",
    });
  } finally {
    btn.disabled = false;
    btn.style.opacity = "";
    btn.innerHTML = originalHtml;
  }
}

function bindFeedForm() {
  document.getElementById("addFeedBtn").addEventListener("click", async () => {
    const btn = document.getElementById("addFeedBtn");
    const label = document.getElementById("newFeedLabel").value.trim();
    const url = document.getElementById("newFeedUrl").value.trim();
    const region = document.getElementById("newFeedRegion").value.trim() || "Custom";
    if (!label || !url) { alert("Give the feed a label and an RSS URL."); return; }

    const editingId = btn.getAttribute("data-editing-id");
    let error, newId = null;
    if (editingId) {
      ({ error } = await supabase.from("feeds").update({ label, url, region }).eq("id", editingId));
      newId = editingId;
    } else {
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      ({ error } = await supabase.from("feeds").insert({ id, label, url, region, enabled: true }));
      newId = id;
    }
    if (error) { alert("Couldn't save: " + error.message); return; }

    pendingChecks.add(newId);
    notify({ message: `${label} added \u2014 checking whether it's valid RSS on the next pipeline run (~10 min).`, severity: "MEDIUM" });

    document.getElementById("newFeedLabel").value = "";
    document.getElementById("newFeedUrl").value = "";
    document.getElementById("newFeedRegion").value = "";
    btn.textContent = "Add feed";
    btn.removeAttribute("data-editing-id");
    loadFeeds(); // refresh the table immediately instead of waiting on Realtime
  });
}

/** Called whenever fresh pipeline data arrives. Any feed we're watching that
 *  now has a health result gets a toast - success or a clear "not RSS" error -
 *  instead of the user having to notice a red dot in the table themselves. */
function checkPendingFeeds() {
  if (!pendingChecks.size || !feedHealthByLabelGetter) return;
  const health = feedHealthByLabelGetter();
  for (const id of [...pendingChecks]) {
    const h = health.find(x => x.id === id);
    if (!h) continue; // not reported yet, keep waiting
    if (h.status === "ok") {
      notify({ message: `${h.label}: confirmed working \u2014 ${h.count} article(s) pulled.`, severity: "LOW" });
    } else if (h.status === "error") {
      notify({ message: `${h.label}: couldn't be read as RSS (${h.error || "unknown error"}). This site is likely out of scope \u2014 check the URL or remove it.`, severity: "HIGH" });
    }
    pendingChecks.delete(id);
  }
}

function bindOPML() {
  document.getElementById("exportOpmlBtn").addEventListener("click", async () => {
    const { data, error } = await supabase.from("feeds").select("*");
    if (error) { alert("Couldn't export: " + error.message); return; }
    downloadTextFile("feeds.opml", toOPML(data || []), "text/x-opml");
  });

  document.getElementById("importOpmlInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseOPML(text);
      const { error } = await supabase.from("feeds").upsert(imported.map(f => ({ ...f })), { onConflict: "id" });
      if (error) throw error;
      alert(`Imported ${imported.length} feed(s) into Supabase.`);
      loadFeeds();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    e.target.value = "";
  });
}
