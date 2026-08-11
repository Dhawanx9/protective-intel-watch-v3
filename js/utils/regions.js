// Maps each country (as it appears in config/countries.json / event.country)
// to a broader region, so Live Feed can be filtered by region as well as by
// individual country. This is a UI-only convenience mapping - it doesn't
// affect classification or the pipeline, just how the frontend groups
// countries for filtering.
export const COUNTRY_TO_REGION = {
  "United States": "North America", "Canada": "North America", "Mexico": "North America",

  "Brazil": "Latin America", "Argentina": "Latin America", "Chile": "Latin America",
  "Colombia": "Latin America", "Venezuela": "Latin America", "Peru": "Latin America",
  "Cuba": "Latin America", "Haiti": "Latin America", "Jamaica": "Latin America",

  "United Kingdom": "Europe", "Germany": "Europe", "France": "Europe", "Italy": "Europe",
  "Spain": "Europe", "Netherlands": "Europe", "Belgium": "Europe", "Sweden": "Europe",
  "Norway": "Europe", "Switzerland": "Europe", "Austria": "Europe", "Portugal": "Europe",
  "Greece": "Europe", "Ireland": "Europe", "Denmark": "Europe", "Finland": "Europe",
  "Poland": "Europe", "Ukraine": "Europe", "Georgia": "Europe", "Armenia": "Europe",
  "Azerbaijan": "Europe", "Cyprus": "Europe", "Serbia": "Europe", "Croatia": "Europe",
  "Bosnia and Herzegovina": "Europe", "Romania": "Europe", "Bulgaria": "Europe",
  "Hungary": "Europe", "Czech Republic": "Europe", "Slovakia": "Europe", "Russia": "Europe",

  "Iran": "Middle East", "Iraq": "Middle East", "Syria": "Middle East", "Israel": "Middle East",
  "Palestine": "Middle East", "Saudi Arabia": "Middle East", "United Arab Emirates": "Middle East",
  "Turkey": "Middle East", "Yemen": "Middle East", "Lebanon": "Middle East", "Jordan": "Middle East",
  "Qatar": "Middle East", "Kuwait": "Middle East", "Bahrain": "Middle East", "Oman": "Middle East",

  "Egypt": "Africa", "Nigeria": "Africa", "South Africa": "Africa", "Kenya": "Africa",
  "Ethiopia": "Africa", "Libya": "Africa", "Sudan": "Africa", "Somalia": "Africa",
  "Mali": "Africa", "Niger": "Africa", "Chad": "Africa",
  "Democratic Republic Of The Congo": "Africa", "Congo": "Africa", "Zimbabwe": "Africa",
  "Zambia": "Africa", "Uganda": "Africa", "Tanzania": "Africa", "Ghana": "Africa",
  "Morocco": "Africa", "Algeria": "Africa", "Tunisia": "Africa",

  "China": "APAC", "Japan": "APAC", "South Korea": "APAC", "North Korea": "APAC",
  "Pakistan": "APAC", "Bangladesh": "APAC", "Afghanistan": "APAC", "India": "APAC",
  "Indonesia": "APAC", "Philippines": "APAC", "Vietnam": "APAC", "Thailand": "APAC",
  "Malaysia": "APAC", "Singapore": "APAC", "Myanmar": "APAC", "Sri Lanka": "APAC",
  "Nepal": "APAC", "New Zealand": "APAC", "Australia": "APAC", "Taiwan": "APAC",
  "Hong Kong": "APAC", "Kazakhstan": "APAC", "Uzbekistan": "APAC",
};

export const ALL_REGIONS = ["North America", "Latin America", "Europe", "Middle East", "Africa", "APAC"];

/** Returns the region for a country, or null if unknown/not mapped - callers
 *  should treat null the same as "Unknown" (excluded from region filtering,
 *  same pattern already used for country === "Unknown" elsewhere). */
export function regionOf(country) {
  return COUNTRY_TO_REGION[country] || null;
}
