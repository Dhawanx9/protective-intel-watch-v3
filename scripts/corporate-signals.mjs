// scripts/corporate-signals.mjs
//
// Detects whether an article is about CORPORATE / MNC leadership and business
// context, vs. political or other unrelated use of the same job-sounding words
// (e.g. "President" of a country vs. "President" of a company).
//
// Used to boost priority within every category (Executive Threats, and any
// other section) so corporate-relevant stories always rank above non-corporate
// ones that happen to match the same category keywords - without hiding the
// non-corporate stories entirely.

// --- 1. Executive / leadership titles -------------------------------------
// Matched case-insensitively, as whole phrases, against title + description.
export const EXECUTIVE_TITLES = [
  "Chairperson", "Chairman", "Vice Chairperson",
  "Board of Directors", "Independent Director",
  "Chief Executive Officer", "CEO",
  "President", "Chief Operating Officer", "COO",
  "Chief Financial Officer", "CFO",
  "Chief Technology Officer", "CTO",
  "Chief Information Officer", "CIO",
  "Chief Information Security Officer", "CISO",
  "Chief Risk Officer", "CRO",
  "Chief Legal Officer", "CLO",
  "General Counsel",
  "Chief Compliance Officer",
  "Chief Human Resources Officer", "CHRO",
  "Chief Marketing Officer", "CMO",
  "Chief Communications Officer", "CCO",
  "Chief Strategy Officer", "CSO",
  "Chief Product Officer", "CPO",
  "Chief Revenue Officer",
  "Chief Data Officer", "CDO",
  "Chief Privacy Officer",
  "Chief Procurement Officer",
  "Chief Supply Chain Officer",
  "Chief Administrative Officer", "CAO",
  "Chief Experience Officer", "CXO",
  "Managing Director", "Executive Director",
  "Regional President", "Regional Director",
  "Country Head", "Business Unit Head", "Division Head",
  "Executive Vice President", "EVP",
  "Senior Vice President", "SVP",
  "Vice President", "VP",
  "Associate Vice President", "AVP",
  "Director", "Senior Director", "Assistant Director",
  "General Manager", "Senior General Manager",
  "Deputy General Manager", "Assistant General Manager",
  "Senior Manager", "Manager", "Assistant Manager",
  "Program Manager", "Project Manager", "Operations Manager",
  "Security Manager", "Facility Manager", "Site Leader",
  "Office Head", "Branch Manager", "Plant Manager",
  "Data Center Manager",
  "Security Operations Center Manager", "SOC Manager",
  "Incident Response Manager",
  "Protective Intelligence Manager",
  "Executive Protection Manager",
  "Corporate Security Director",
  "Corporate Security Manager",
];

// --- 2. Corporate / business context words ---------------------------------
// Presence of these alongside a title is a strong signal the title is being
// used in a company context, not a political or governmental one.
const CORPORATE_CONTEXT_WORDS = [
  "company", "corporation", "corporate", "firm", "enterprise",
  "shareholders", "shareholder", "board meeting", "earnings",
  "quarterly results", "acquisition", "merger", "headquarters", "hq",
  "subsidiary", "conglomerate", "multinational", "mnc",
  "stock", "shares", "ipo", "revenue", "fortune 500", "fortune500",
  "workforce", "employees", "staff", "layoffs", "office", "campus",
  "plant", "factory", "facility", "supply chain", "vendor", "client",
  "customers", "investor", "investors", "board of directors",
];

// --- 3. Political / government context words --------------------------------
// Presence of these (without corporate context words) suggests the title is
// being used politically, not corporately - used to DEPRIORITIZE and to
// block the Executive Threats reclassification, never to hide the story.
const POLITICAL_CONTEXT_WORDS = [
  "president of the united states", "prime minister", "parliament",
  "senate", "congress", "election", "campaign", "governor", "mayor",
  "cabinet", "ministry", "government", "administration", "white house",
  "party leader", "opposition", "legislature", "president trump",
  "president biden", "head of state", "diplomat", "embassy",
  "defence minister", "defense minister", "home minister", "foreign minister",
  "finance minister", "union minister", "chief minister", "minister of",
  "member of parliament", "lok sabha", "rajya sabha", "parliament house",
  "state department", "foreign ministry", "national security adviser",
  "president of india", "president of pakistan", "president of china",
  "supreme leader", "president putin", "president xi", "president zelensky",
];

// --- 4. Common corporate suffixes / company-name patterns -------------------
const CORPORATE_SUFFIXES = [
  "Inc.", "Inc", "Corp.", "Corp", "Corporation", "Ltd.", "Ltd", "LLC",
  "PLC", "Plc", "Group", "Holdings", "Industries", "Enterprises",
  "Technologies", "Solutions", "Systems", "Co.",
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match only - "cto" will NOT match inside "inspector", "vp"
 *  will NOT match inside an unrelated word, etc. This is the permanent fix
 *  for the class of bug where a short acronym (CTO, VP, COO, CFO, CRO...)
 *  happens to be a substring of a completely unrelated ordinary word.
 *  Plain .includes() has no concept of word boundaries; lookaround
 *  assertions do, and unlike \b they correctly treat things like
 *  apostrophes or accented letters as non-word characters too. Used for
 *  every phrase check in this file, not just short ones - multi-word
 *  phrases benefit from the same safety. */
function wordBoundaryTest(lowerText, phraseLower) {
  const escaped = escapeRegex(phraseLower);
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return re.test(lowerText);
}

function findAllWordBoundaryPositions(lowerText, phraseLower) {
  const escaped = escapeRegex(phraseLower);
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
  const positions = [];
  let match;
  while ((match = re.exec(lowerText)) !== null) {
    positions.push(match.index);
    if (match[0].length === 0) re.lastIndex++; // safety against zero-length matches
  }
  return positions;
}

function containsAny(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.some(n => wordBoundaryTest(lower, n.toLowerCase()));
}

function countMatches(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.reduce((count, n) => wordBoundaryTest(lower, n.toLowerCase()) ? count + 1 : count, 0);
}

// --- Proximity matching --------------------------------------------------
// A word appearing ANYWHERE in an article is weak evidence - "Director"
// could be in an unrelated sentence three paragraphs away from the actual
// incident being reported. This is the root cause of most false positives
// we've hit (a police "Director" mentioned in a terrorism story, a
// politician's "President" title mentioned in passing). Proximity matching
// fixes this permanently and for free: it only counts as a real signal when
// an executive title and an incident phrase appear close together in the
// text - the way they actually would if the article is really about a
// threat TO that executive, rather than the two concepts being unrelated
// mentions in the same piece.
const PROXIMITY_WINDOW_CHARS = 80;

/**
 * Returns true only if an executive title AND one of the given incident
 * phrases both appear in the text as WHOLE WORDS (not substrings hiding
 * inside unrelated words - e.g. "cto" no longer matches inside
 * "inspector"), AND at least one occurrence of each is within
 * PROXIMITY_WINDOW_CHARS characters of the other.
 */
export function hasExecutiveIncidentNearby(text, incidentPhrases) {
  const lower = (text || "").toLowerCase();

  const titlePositions = [];
  for (const t of EXECUTIVE_TITLES) {
    titlePositions.push(...findAllWordBoundaryPositions(lower, t.toLowerCase()));
  }
  if (!titlePositions.length) return false;

  const incidentPositions = [];
  for (const w of incidentPhrases || []) {
    incidentPositions.push(...findAllWordBoundaryPositions(lower, w.toLowerCase()));
  }
  if (!incidentPositions.length) return false;

  return titlePositions.some(tp => incidentPositions.some(ip => Math.abs(tp - ip) <= PROXIMITY_WINDOW_CHARS));
}

/**
 * Analyzes an article's title + description and returns a corporate-signal
 * score plus a boolean flag the frontend/pipeline can use for sorting.
 *
 * @param {string} title
 * @param {string} description
 * @returns {{
 *   hasExecutiveTitle: boolean,
 *   corporateScore: number,
 *   isCorporate: boolean,
 *   isLikelyPolitical: boolean
 * }}
 */
export function analyzeCorporateSignal(title = "", description = "") {
  const text = `${title} ${description}`;

  const hasExecutiveTitle = containsAny(text, EXECUTIVE_TITLES);
  const corporateContextHits = countMatches(text, CORPORATE_CONTEXT_WORDS);
  const politicalContextHits = countMatches(text, POLITICAL_CONTEXT_WORDS);
  const hasCorporateSuffix = containsAny(text, CORPORATE_SUFFIXES);

  // Score: weighted so a title + real corporate context clearly outranks a
  // title alone (which is often ambiguous, e.g. "Director" could be anything).
  let corporateScore = 0;
  if (hasExecutiveTitle) corporateScore += 1;
  if (hasCorporateSuffix) corporateScore += 2;
  corporateScore += corporateContextHits * 2;
  corporateScore -= politicalContextHits * 2;

  // Political wins only if political signals clearly outweigh corporate ones.
  const isLikelyPolitical = politicalContextHits > 0 && politicalContextHits >= corporateContextHits + (hasCorporateSuffix ? 1 : 0);

  const isCorporate = !isLikelyPolitical && (hasCorporateSuffix || corporateContextHits > 0);

  return {
    hasExecutiveTitle,
    corporateScore: Math.max(0, corporateScore),
    isCorporate,
    isLikelyPolitical,
  };
}
