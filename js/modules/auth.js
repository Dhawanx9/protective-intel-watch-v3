// Simple shared-password login gate for the whole team - one password, no
// individual accounts. This is a DETERRENT, not real security: the whole
// site is static (no server), so the hash comparison happens entirely in
// the browser and a technically determined person could find a way around
// it by reading the JavaScript. It's meant to keep casual visitors and
// search engine crawlers out, not to protect genuinely sensitive data -
// that was an explicit, deliberate tradeoff, not an oversight.
const PASSWORD_HASH = "5f28db32c78bd1f07d641760396f95ea8e7db040e5fc5a5b009b3ae1cd626bf8";
const STORAGE_KEY = "piw_authenticated";

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function isAuthenticated() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

/** Shows the login screen if not authenticated; once the correct password
 *  is entered, stores that in localStorage (persists across browser
 *  sessions, so the team doesn't have to log in every visit) and calls
 *  onSuccess() to actually initialize the dashboard. */
export function initLoginGate(onSuccess) {
  const loginScreen = document.getElementById("loginScreen");
  const appRoot = document.querySelector(".app");

  if (isAuthenticated()) {
    loginScreen.style.display = "none";
    appRoot.style.display = "";
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
      loginScreen.style.display = "none";
      appRoot.style.display = "";
      onSuccess();
    } else {
      errorEl.textContent = "Incorrect password. Try again.";
      input.value = "";
      input.focus();
    }
  });
}
