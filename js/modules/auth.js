// Simple shared-password login gate for the whole team - one password, no
// individual accounts. This is a DETERRENT, not real security: the whole
// site is static (no server), so the hash comparison happens entirely in
// the browser and a technically determined person could find a way around
// it by reading the JavaScript. It's meant to keep casual visitors and
// search engine crawlers out, not to protect genuinely sensitive data -
// that was an explicit, deliberate tradeoff, not an oversight.
const PASSWORD_HASH = "5f28db32c78bd1f07d641760396f95ea8e7db040e5fc5a5b009b3ae1cd626bf8";
const STORAGE_KEY = "piw_authenticated";
const LAST_ACTIVITY_KEY = "piw_last_activity";

// Auto-logout after this long with no mouse/keyboard/scroll activity.
// Stored as a real timestamp (not just a JS setTimeout) so it survives
// page reloads and correctly catches a tab that was left open and
// backgrounded, not just one sitting idle in the foreground.
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function isAuthenticated() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function recordActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function getLastActivity() {
  const v = localStorage.getItem(LAST_ACTIVITY_KEY);
  return v ? parseInt(v, 10) : Date.now();
}

function isSessionExpired() {
  return Date.now() - getLastActivity() > SESSION_TIMEOUT_MS;
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

/** Small throttle helper - activity events (especially mousemove) fire far
 *  too often to write to localStorage on every single one; this caps it to
 *  at most once every few seconds, which is still more than responsive
 *  enough for a 5-minute timeout. */
function throttle(fn, waitMs) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= waitMs) { last = now; fn(...args); }
  };
}

/** Starts watching for user activity and periodically checks whether the
 *  session has gone idle past SESSION_TIMEOUT_MS. Uses a real stored
 *  timestamp + periodic check (not a single setTimeout) so it correctly
 *  catches a tab that was backgrounded/inactive and comes back after the
 *  timeout has already passed, not just continuous foreground idling. */
function startActivityMonitor() {
  recordActivity();
  const throttledRecord = throttle(recordActivity, 5000);
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt =>
    window.addEventListener(evt, throttledRecord, { passive: true })
  );

  setInterval(() => {
    if (isSessionExpired()) {
      clearSession();
      location.reload();
    }
  }, 10000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isSessionExpired()) {
      clearSession();
      location.reload();
    }
  });
}

/** Shows the login screen if not authenticated (or if the previous session
 *  timed out from inactivity); once the correct password is entered,
 *  stores that in localStorage (persists across browser sessions, so the
 *  team doesn't have to log in every visit - until they go idle for 5
 *  minutes) and calls onSuccess() to actually initialize the dashboard. */
export function initLoginGate(onSuccess) {
  const loginScreen = document.getElementById("loginScreen");
  const appRoot = document.querySelector(".app");

  if (isAuthenticated() && isSessionExpired()) {
    clearSession();
  }

  if (isAuthenticated()) {
    loginScreen.style.display = "none";
    appRoot.style.display = "";
    startActivityMonitor();
    onSuccess();
    return;
  }

  appRoot.style.display = "none";
  loginScreen.style.display = "flex";

  const form = document.getElementById("loginForm");
  const input = document.getElementById("loginPasswordInput");
  const errorEl = document.getElementById("loginError");
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256Hex(input.value);
    if (hash === PASSWORD_HASH) {
      localStorage.setItem(STORAGE_KEY, "true");
      recordActivity();
      loginScreen.style.display = "none";
      appRoot.style.display = "";
      startActivityMonitor();
      onSuccess();
    } else {
      errorEl.textContent = "Incorrect password. Try again.";
      input.value = "";
      input.focus();
    }
  });
}
