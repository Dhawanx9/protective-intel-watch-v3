import { escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";
import { parseOPML, toOPML, downloadTextFile } from "../utils/opml.js";
import { supabase, isSupabaseConfigured } from "../supabaseClient.js";

let currentUser = null;
let feedHealthByLabel = {}; // keyed by feed id, populated from data/latest.json meta

export function initFeedManager({ getFeedHealth }) {
  feedHealthByLabelGetter = getFeedHealth;

  if (!isSupabaseConfigured()) {
    document.getElementById("feedManagerBody").innerHTML =
      `<div class="error-state">Supabase isn't configured yet. Fill in <code>js/supabaseConfig.js</code> with your project URL and anon key, and run <code>supabase/schema.sql</code> in your Supabase SQL editor first.</div>`;
    return;
  }

  bindAuthForm();
  bindFeedForm();
  bindOPML();

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    renderAuthState();
    loadFeeds();
  });

  supabase.auth.getSession().then(({ data }) => {
    currentUser = data.session?.user || null;
    renderAuthState();
    loadFeeds();
  });

  // Live updates: if a teammate adds/edits/removes a feed in another tab,
  // this tab's table refreshes automatically via Supabase Realtime.
  supabase
    .channel("feeds-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "feeds" }, () => loadFeeds())
    .subscribe();
}

let feedHealthByLabelGetter = null;

function renderAuthState() {
  const signedOutBox = document.getElementById("authSignedOut");
  const signedInBox = document.getElementById("authSignedIn");
  const writeControls = document.querySelectorAll("[data-requires-auth]");
  if (currentUser) {
    signedOutBox.style.display = "none";
    signedInBox.style.display = "flex";
    document.getElementById("authEmailLabel").textContent = currentUser.email;
    writeControls.forEach(el => el.style.display = "");
  } else {
    signedOutBox.style.display = "flex";
    signedInBox.style.display = "none";
    writeControls.forEach(el => el.style.display = "none");
  }
}

function bindAuthForm() {
  document.getElementById("sendMagicLinkBtn").addEventListener("click", async () => {
    const email = document.getElementById("authEmailInput").value.trim();
    if (!email) { alert("Enter your email first."); return; }
    const btn = document.getElementById("sendMagicLinkBtn");
    btn.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    btn.textContent = "Send sign-in link";
    if (error) alert("Couldn't send sign-in link: " + error.message);
    else alert(`Check ${email} for a sign-in link. If your email isn't on the admin allowlist, the link will work but writes will still be rejected by the database.`);
  });

  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}

async function loadFeeds() {
  const { data, error } = await supabase.from("feeds").select("*").order("label");
  const tbody = document.getElementById("feedRows");
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="error-state">Couldn't load feeds from Supabase: ${escapeHtml(error.message)}</div></td></tr>`;
    return;
  }
  renderTable(data || []);
}

function renderTable(feeds) {
  const tbody = document.getElementById("feedRows");
  const health = feedHealthByLabelGetter ? feedHealthByLabelGetter() : [];

  tbody.innerHTML = feeds.length ? feeds.map(f => {
    const h = health.find(x => x.id === f.id);
    const statusClass = !f.enabled ? "disabled" : h?.status === "ok" ? "ok" : h?.status === "error" ? "err" : "disabled";
    const statusLabel = !f.enabled ? "Disabled" : h?.status === "ok" ? "Healthy" : h?.status === "error" ? "Error" : "Pending next run";
    const lastPull = h?.checkedAt ? timeAgo(h.checkedAt) : "\u2014";
    const count = h?.count ?? "\u2014";
    const errTitle = h?.error ? ` title="${escapeHtml(h.error)}"` : "";
    return `<tr data-id="${escapeHtml(f.id)}">
      <td${errTitle}><span class="status-dot ${statusClass}"></span>${statusLabel}</td>
      <td>
        <div><b>${escapeHtml(f.label)}</b></div>
        <div class="mono" style="font-size:10.5px;color:var(--text-faint);">${escapeHtml(f.url)}</div>
      </td>
      <td class="mono">${lastPull}</td>
      <td class="mono">${count}</td>
      <td><div class="toggle${f.enabled ? " on" : ""}" data-toggle data-requires-auth style="display:none;"></div><span data-no-auth style="color:var(--text-faint);">${f.enabled ? "On" : "Off"}</span></td>
      <td class="row-actions" data-requires-auth style="display:none;"><button class="btn small" data-edit>Edit</button> <button class="btn small danger" data-remove>Delete</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty-state">No feeds yet. Add one on the right, or run <code>npm run seed-supabase</code> to import the starter set.</div></td></tr>`;

  // Re-apply auth visibility to freshly-rendered rows
  document.querySelectorAll("[data-requires-auth]").forEach(el => el.style.display = currentUser ? "" : "none");
  document.querySelectorAll("[data-no-auth]").forEach(el => el.style.display = currentUser ? "none" : "");

  tbody.querySelectorAll("[data-toggle]").forEach(t => t.addEventListener("click", async () => {
    const row = t.closest("tr");
    const id = row.getAttribute("data-id");
    const feed = feeds.find(f => f.id === id);
    const { error } = await supabase.from("feeds").update({ enabled: !feed.enabled }).eq("id", id);
    if (error) alert("Couldn't update: " + error.message);
  }));

  tbody.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
    const row = b.closest("tr");
    const id = row.getAttribute("data-id");
    if (!confirm(`Delete feed "${id}"? This can't be undone.`)) return;
    const { error } = await supabase.from("feeds").delete().eq("id", id);
    if (error) alert("Couldn't delete: " + error.message);
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
}

function bindFeedForm() {
  document.getElementById("addFeedBtn").addEventListener("click", async () => {
    const btn = document.getElementById("addFeedBtn");
    const label = document.getElementById("newFeedLabel").value.trim();
    const url = document.getElementById("newFeedUrl").value.trim();
    const region = document.getElementById("newFeedRegion").value.trim() || "Custom";
    if (!label || !url) { alert("Give the feed a label and an RSS URL."); return; }

    const editingId = btn.getAttribute("data-editing-id");
    let error;
    if (editingId) {
      ({ error } = await supabase.from("feeds").update({ label, url, region }).eq("id", editingId));
    } else {
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      ({ error } = await supabase.from("feeds").insert({ id, label, url, region, enabled: true }));
    }
    if (error) { alert("Couldn't save: " + error.message); return; }

    document.getElementById("newFeedLabel").value = "";
    document.getElementById("newFeedUrl").value = "";
    document.getElementById("newFeedRegion").value = "";
    btn.textContent = "Add feed";
    btn.removeAttribute("data-editing-id");
  });
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
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    e.target.value = "";
  });
}
