const VIEW_TITLES = {
  dashboard: "Executive Summary",
  feed: "Live Intelligence Feed",
  map: "Interactive Map",
  analytics: "Analytics",
  brief: "Daily Intelligence Brief",
  feedManager: "Feed Manager",
  settings: "Settings"
};

let onChangeCallback = null;

export function initRouter({ onChange }) {
  onChangeCallback = onChange;
  document.querySelectorAll(".nav-item[data-view]").forEach(el => {
    el.addEventListener("click", () => navigateTo(el.getAttribute("data-view")));
  });
  navigateTo("dashboard");
}

export function navigateTo(view) {
  document.querySelectorAll(".nav-item[data-view]").forEach(el => {
    el.classList.toggle("active", el.getAttribute("data-view") === view);
  });
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add("active");
  const titleEl = document.getElementById("viewTitle");
  if (titleEl) titleEl.textContent = VIEW_TITLES[view] || view;
  if (onChangeCallback) onChangeCallback(view);
}
