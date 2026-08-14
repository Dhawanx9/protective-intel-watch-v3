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
// Matched case-insensitively, as whole (stemmed) words, against title + description.
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

/** Lightweight suffix-stripping stemmer. Reduces regular English
 *  inflections (plurals, past tense, gerunds, "-er"/"-ers" agent nouns) to
 *  a common root, so "stalker", "stalking", and "stalked" all collapse to
 *  "stalk" and match the same keyword without needing every grammatical
 *  form spelled out in a config file. This deliberately does NOT attempt
 *  full linguistic stemming (irregular derivations like threat -> threaten
 *  aren't caught by suffix rules alone and still need to be listed
 *  explicitly in categories.json) - it only handles the regular,
 *  mechanical inflections, which cover the vast majority of real-world
 *  keyword-matching misses like this one. */
function stem(word) {
  const w = word;
  if (w.length > 6 && w.endsWith("ers")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("er")) return w.slice(0, -2);
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Splits text into real word tokens only (letters/digits) - this is what
 *  keeps "cto" from ever matching inside "doctor": tokenization only
 *  produces whole words to begin with, so a short acronym can never be a
 *  substring hit inside an unrelated longer word. Stemming is applied on
 *  top of these whole tokens, never on raw substrings. */
function tokenize(text) {
  return ((text || "").toLowerCase().match(/[a-z0-9]+/g)) || [];
}

/** Finds every token-index position where `phrase` (a possibly multi-word
 *  string, e.g. "death threat") appears in `textTokens`, comparing each
 *  word by STEM rather than exact spelling. Returns an array of starting
 *  token positions (used for proximity matching below), not booleans. */
function findPhrasePositions(textTokens, phrase) {
  const phraseTokens = tokenize(phrase).map(stem);
  if (!phraseTokens.length) return [];
  const stemmedText = textTokens.map(stem);
  const positions = [];
  for (let i = 0; i <= stemmedText.length - phraseTokens.length; i++) {
    let match = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (stemmedText[i + j] !== phraseTokens[j]) { match = false; break; }
    }
    if (match) positions.push(i);
  }
  return positions;
}

function containsAny(haystack, needles) {
  const tokens = tokenize(haystack);
  return needles.some(n => findPhrasePositions(tokens, n).length > 0);
}

function countMatches(haystack, needles) {
  const tokens = tokenize(haystack);
  return needles.reduce((count, n) => findPhrasePositions(tokens, n).length > 0 ? count + 1 : count, 0);
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
// mentions in the same piece. Measured in TOKENS (words) rather than raw
// character count, since a fixed character window behaves inconsistently
// across short vs. long words - roughly equivalent to the old 80-character
// window for typical headline-length text.
const PROXIMITY_WINDOW_TOKENS = 14;

/**
 * Returns true only if an executive title AND one of the given incident
 * phrases both appear in the text as whole (stemmed) words, AND at least
 * one occurrence of each is within PROXIMITY_WINDOW_TOKENS words of the
 * other.
 */
export function hasExecutiveIncidentNearby(text, incidentPhrases) {
  const tokens = tokenize(text);

  const titlePositions = [];
  for (const t of EXECUTIVE_TITLES) titlePositions.push(...findPhrasePositions(tokens, t));
  if (!titlePositions.length) return false;

  const incidentPositions = [];
  for (const w of incidentPhrases || []) incidentPositions.push(...findPhrasePositions(tokens, w));
  if (!incidentPositions.length) return false;

  return titlePositions.some(tp => incidentPositions.some(ip => Math.abs(tp - ip) <= PROXIMITY_WINDOW_TOKENS));
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
