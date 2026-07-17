// One-time helper: pushes the starter list in config/feeds.json into your Supabase
// `feeds` table. Run this once after setting up Supabase (supabase/schema.sql) and
// filling in your credentials. After this, config/feeds.json is no longer read by
// anything — Supabase is the live source of truth, managed from the Feed Manager UI.
//
// Usage:
//   SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=your-anon-key node scripts/seed-supabase.mjs
//
// Note: because of the RLS policies in supabase/schema.sql, inserting rows this way
// requires either (a) temporarily using your service_role key instead of the anon key
// for this one-off script (never commit that key), or (b) running the equivalent
// INSERT statements directly in the Supabase SQL Editor, which is simpler for a
// one-time seed. This script is provided for convenience if you prefer the CLI.
import { readFile } from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function main() {
  if (!SUPABASE_URL || !KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred for seeding) or SUPABASE_ANON_KEY.");
    process.exit(1);
  }
  const config = JSON.parse(await readFile(new URL("../config/feeds.json", import.meta.url), "utf8"));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/feeds`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify(config.feeds)
  });

  if (!res.ok) {
    console.error(`Seed failed: HTTP ${res.status}`, await res.text());
    process.exit(1);
  }
  console.log(`Seeded ${config.feeds.length} feeds into Supabase.`);
}

main();
