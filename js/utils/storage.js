const PREFIX = "piw_v2_";

export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function setItem(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
  catch { /* storage unavailable - silently no-op */ }
}

export function removeItem(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* noop */ }
}
