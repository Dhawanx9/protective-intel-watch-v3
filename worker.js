// Minimal entry-point required by Wrangler even for a pure static site.
// It does nothing beyond handing every request straight to the static
// assets binding - Cloudflare still serves matching files directly and
// only reaches this script as a fallback, so this doesn't add any real
// logic or slow anything down.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
