import { store } from "../state.js";

export function initSettings({ onRefreshIntervalChange }) {
  const s = store.data.settings;

  const refreshInput = document.getElementById("settingRefreshInterval");
  refreshInput.value = s.refreshIntervalMinutes;
  refreshInput.addEventListener("change", () => {
    const mins = Math.max(1, Number(refreshInput.value) || 10);
    store.updateSettings({ refreshIntervalMinutes: mins });
    onRefreshIntervalChange(mins);
  });

  const clusterToggle = document.getElementById("settingMapClustering");
  clusterToggle.classList.toggle("on", s.mapClustering);
  clusterToggle.addEventListener("click", () => {
    const next = !store.data.settings.mapClustering;
    store.updateSettings({ mapClustering: next });
    clusterToggle.classList.toggle("on", next);
  });

  const notifToggle = document.getElementById("settingNotificationsEnabled");
  notifToggle.classList.toggle("on", s.notificationsEnabled);
  notifToggle.addEventListener("click", () => {
    const next = !store.data.settings.notificationsEnabled;
    store.updateSettings({ notificationsEnabled: next });
    notifToggle.classList.toggle("on", next);
  });

  const highOnlyToggle = document.getElementById("settingNotifyHighOnly");
  highOnlyToggle.classList.toggle("on", s.notifyOnHighSeverity);
  highOnlyToggle.addEventListener("click", () => {
    const next = !store.data.settings.notifyOnHighSeverity;
    store.updateSettings({ notifyOnHighSeverity: next });
    highOnlyToggle.classList.toggle("on", next);
  });
}
