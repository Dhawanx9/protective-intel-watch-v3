// Fires the "Intelligence Pipeline" GitHub Actions workflow on a reliable
// 10-minute cadence. GitHub's own `schedule:` cron event is best-effort and
// gets queued/delayed under platform load - in practice this project saw
// gaps of 45-80 minutes instead of 10. Triggering via workflow_dispatch
// from Cloudflare's Cron Triggers (which DO fire on schedule) sidesteps
// that entirely: GitHub runs a workflow_dispatch-triggered run immediately,
// with no scheduling queue involved.
//
// SETUP REQUIRED before this works:
//   1. Create a GitHub fine-grained personal access token scoped to this
//      repo only, with "Actions: Read and write" permission.
//   2. Add it as a secret on this Worker:
//        wrangler secret put GITHUB_TOKEN
//      (paste the token when prompted - it is never written into this file
//      or committed to the repo).
//   3. Deploy: wrangler deploy
//
// If your repo owner, name, or workflow filename ever change, update the
// three constants below to match.
const GITHUB_OWNER = "dhawanx9";
const GITHUB_REPO = "protective-intel-watch-v3";
const WORKFLOW_FILE = "pipeline.yml"; // the file under .github/workflows/
const BRANCH = "main";

async function triggerPipeline(env) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub's API requires a User-Agent header on every request.
      "User-Agent": "protective-intel-pipeline-trigger-worker"
    },
    body: JSON.stringify({ ref: BRANCH })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[pipeline-trigger] GitHub API returned ${res.status}: ${text}`);
    throw new Error(`GitHub workflow_dispatch failed: HTTP ${res.status} ${text}`);
  }

  console.log(`[pipeline-trigger] dispatched ${WORKFLOW_FILE} on ${BRANCH} successfully`);
}

export default {
  // The actual cron entry point - Cloudflare calls this on the schedule
  // defined in wrangler.toml. ctx.waitUntil keeps the Worker alive long
  // enough for the fetch to complete before Cloudflare tears it down.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerPipeline(env));
  },

  // A manual trigger for testing, so you don't have to wait up to 10
  // minutes to confirm this works. Requires the same GitHub token as a
  // Bearer auth header, so only someone who already has the token (i.e.
  // you) can hit this - it's not a public "anyone can spam-trigger your
  // pipeline" endpoint.
  //
  // Test with:
  //   curl -X POST https://<your-worker-subdomain>.workers.dev \
  //     -H "Authorization: Bearer <same GITHUB_TOKEN value>"
  async fetch(request, env) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.GITHUB_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      await triggerPipeline(env);
      return new Response("Pipeline triggered successfully.", { status: 200 });
    } catch (err) {
      return new Response(`Failed: ${err.message}`, { status: 500 });
    }
  }
};
