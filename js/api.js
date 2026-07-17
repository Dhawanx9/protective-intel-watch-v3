// The dashboard NEVER fetches RSS directly. It only ever reads the JSON that the
// GitHub Actions pipeline (scripts/build.mjs) already generated and committed.
const DATA_URL = "data/latest.json";

export async function loadIntelligenceData() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load intelligence data (HTTP ${res.status})`);
  const json = await res.json();
  const events = (json.events || []).map(e => ({ ...e, isNew: false }));
  return { events, meta: json.meta || null };
}
