import { store } from "../state.js";
import { el, escapeHtml } from "../utils/dom.js";
import { timeAgo } from "../utils/time.js";

let stackEl;

export function initNotifications() {
  stackEl = document.getElementById("toastStack");
  renderHistory();
  store.subscribe(topic => { if (topic === "notifications") renderHistory(); });

  document.getElementById("clearNotificationsBtn").addEventListener("click", () => {
    store.clearNotifications();
  });
}

export function notify({ message, severity = "info", link = null }) {
  if (!store.data.settings.notificationsEnabled) return;
  store.pushNotification({ message, severity, link });
  showToast({ message, severity, link });
}

function showToast({ message, severity, link }) {
  const toast = el("div", { class: `toast ${severity.toLowerCase()}` }, [
    el("div", { class: "msg" }, [
      link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", html: escapeHtml(message) }) : message
    ]),
    el("button", { class: "close", "aria-label": "Dismiss", onclick: () => toast.remove() }, "\u2715")
  ]);
  stackEl.appendChild(toast);
  setTimeout(() => toast.remove(), 9000);
}

function renderHistory() {
  const root = document.getElementById("notificationHistory");
  if (!root) return;
  const items = store.data.notifications;
  root.innerHTML = items.length
    ? items.map(n => `
      <div class="mini-item">
        ${n.link ? `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.message)}</a>` : escapeHtml(n.message)}
        <div class="meta">${timeAgo(n.at)} \u00b7 ${n.severity}</div>
      </div>`).join("")
    : '<div class="empty-state">No notifications yet.</div>';
}
