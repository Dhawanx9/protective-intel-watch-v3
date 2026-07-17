import { store } from "../state.js";

export function initTheme() {
  applyTheme(store.data.settings.theme);
  const btn = document.getElementById("themeToggleBtn");
  btn.addEventListener("click", () => {
    const next = store.data.settings.theme === "light" ? "dark" : "light";
    store.updateSettings({ theme: next });
    applyTheme(next);
  });
}

function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const label = document.getElementById("themeToggleLabel");
  if (label) label.textContent = theme === "light" ? "Light" : "Dark";
}
