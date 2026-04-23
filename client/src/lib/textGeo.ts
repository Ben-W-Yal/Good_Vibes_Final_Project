/**
 * Lightweight client-side geocoder for news articles whose only known coordinate
 * is the publisher country's centroid (Perigon / GDELT DOC fallback).
 *
 * Given the article's title + description we look for the first mention of a
 * conflict-relevant country or well-known city and return an approximate
 * lat/lng. Country names are tried first (word-boundary matching), then a
 * small roster of hotspot cities. Order matters: more specific places come
 * before regions so that "Kyiv" wins over "Ukraine".
 */

export interface TextGeoHit {
  lat: number;
  lng: number;
  name: string;
  kind: "city" | "country";
}

/** Conflict-relevant cities — order matters (more specific first). */
const CITY_ENTRIES: Array<[string, number, number, string]> = [
  ["Kyiv", 50.45, 30.52, "Kyiv, Ukraine"],
  ["Kiev", 50.45, 30.52, "Kyiv, Ukraine"],
  ["Mariupol", 47.1, 37.55, "Mariupol, Ukraine"],
  ["Bakhmut", 48.6, 38.0, "Bakhmut, Ukraine"],
  ["Kharkiv", 49.99, 36.23, "Kharkiv, Ukraine"],
  ["Odesa", 46.48, 30.73, "Odesa, Ukraine"],
  ["Odessa", 46.48, 30.73, "Odesa, Ukraine"],
  ["Lviv", 49.84, 24.03, "Lviv, Ukraine"],
  ["Moscow", 55.75, 37.62, "Moscow, Russia"],
  ["St Petersburg", 59.93, 30.34, "St Petersburg, Russia"],
  ["Gaza", 31.5, 34.47, "Gaza"],
  ["Rafah", 31.29, 34.24, "Rafah, Gaza"],
  ["Khan Younis", 31.35, 34.3, "Khan Younis, Gaza"],
  ["Tel Aviv", 32.08, 34.78, "Tel Aviv, Israel"],
  ["Jerusalem", 31.78, 35.22, "Jerusalem"],
  ["Beirut", 33.89, 35.5, "Beirut, Lebanon"],
  ["Damascus", 33.51, 36.28, "Damascus, Syria"],
  ["Aleppo", 36.2, 37.13, "Aleppo, Syria"],
  ["Baghdad", 33.31, 44.36, "Baghdad, Iraq"],
  ["Tehran", 35.69, 51.39, "Tehran, Iran"],
  ["Sanaa", 15.37, 44.19, "Sanaa, Yemen"],
  ["Khartoum", 15.5, 32.56, "Khartoum, Sudan"],
  ["Port Sudan", 19.62, 37.22, "Port Sudan"],
  ["Addis Ababa", 9.03, 38.74, "Addis Ababa, Ethiopia"],
  ["Juba", 4.86, 31.57, "Juba, South Sudan"],
  ["Kinshasa", -4.44, 15.27, "Kinshasa, DRC"],
  ["Goma", -1.67, 29.22, "Goma, DRC"],
  ["Kabul", 34.53, 69.17, "Kabul, Afghanistan"],
  ["Islamabad", 33.69, 73.06, "Islamabad, Pakistan"],
  ["Karachi", 24.86, 67.01, "Karachi, Pakistan"],
  ["Kashmir", 34.08, 74.8, "Kashmir"],
  ["New Delhi", 28.61, 77.23, "New Delhi, India"],
  ["Taipei", 25.04, 121.56, "Taipei, Taiwan"],
  ["Seoul", 37.57, 126.98, "Seoul, South Korea"],
  ["Pyongyang", 39.04, 125.76, "Pyongyang, North Korea"],
  ["Beijing", 39.91, 116.41, "Beijing, China"],
  ["Hong Kong", 22.32, 114.17, "Hong Kong"],
  ["Port-au-Prince", 18.59, -72.31, "Port-au-Prince, Haiti"],
  ["Caracas", 10.49, -66.88, "Caracas, Venezuela"],
];

/** Country -> centroid. Keep this focused on conflict / news hotspots. */
const COUNTRY_ENTRIES: Array<[string, number, number, string]> = [
  ["Ukraine", 49.0, 31.4, "Ukraine"],
  ["Russia", 61.52, 105.32, "Russia"],
  ["Belarus", 53.71, 27.95, "Belarus"],
  ["Moldova", 47.41, 28.37, "Moldova"],
  ["Poland", 51.92, 19.15, "Poland"],
  ["Israel", 31.05, 34.85, "Israel"],
  ["Palestine", 31.95, 35.23, "Palestine"],
  ["Lebanon", 33.85, 35.86, "Lebanon"],
  ["Syria", 34.8, 38.99, "Syria"],
  ["Iraq", 33.22, 43.68, "Iraq"],
  ["Iran", 32.43, 53.69, "Iran"],
  ["Yemen", 15.55, 48.52, "Yemen"],
  ["Saudi Arabia", 23.89, 45.08, "Saudi Arabia"],
  ["Qatar", 25.35, 51.18, "Qatar"],
  ["Bahrain", 26.07, 50.56, "Bahrain"],
  ["Kuwait", 29.31, 47.48, "Kuwait"],
  ["UAE", 23.42, 53.85, "United Arab Emirates"],
  ["United Arab Emirates", 23.42, 53.85, "United Arab Emirates"],
  ["Oman", 21.51, 55.92, "Oman"],
  ["Jordan", 30.59, 36.24, "Jordan"],
  ["Egypt", 26.82, 30.8, "Egypt"],
  ["Libya", 26.34, 17.23, "Libya"],
  ["Tunisia", 33.89, 9.54, "Tunisia"],
  ["Algeria", 28.03, 1.66, "Algeria"],
  ["Morocco", 31.79, -7.09, "Morocco"],
  ["Sudan", 12.86, 30.22, "Sudan"],
  ["South Sudan", 6.88, 31.31, "South Sudan"],
  ["Ethiopia", 9.15, 40.49, "Ethiopia"],
  ["Eritrea", 15.18, 39.78, "Eritrea"],
  ["Somalia", 5.15, 46.2, "Somalia"],
  ["Kenya", -0.02, 37.91, "Kenya"],
  ["Nigeria", 9.08, 8.68, "Nigeria"],
  ["Mali", 17.57, -3.99, "Mali"],
  ["Niger", 17.6, 8.08, "Niger"],
  ["Chad", 15.45, 18.73, "Chad"],
  ["Burkina Faso", 12.24, -1.56, "Burkina Faso"],
  ["Democratic Republic of the Congo", -4.04, 21.76, "DR Congo"],
  ["DR Congo", -4.04, 21.76, "DR Congo"],
  ["DRC", -4.04, 21.76, "DR Congo"],
  ["Congo", -4.04, 21.76, "Congo"],
  ["Rwanda", -1.94, 29.87, "Rwanda"],
  ["Uganda", 1.37, 32.29, "Uganda"],
  ["Mozambique", -18.67, 35.53, "Mozambique"],
  ["Afghanistan", 33.94, 67.71, "Afghanistan"],
  ["Pakistan", 30.38, 69.35, "Pakistan"],
  ["India", 20.59, 78.96, "India"],
  ["Bangladesh", 23.68, 90.36, "Bangladesh"],
  ["Myanmar", 21.91, 95.96, "Myanmar"],
  ["Burma", 21.91, 95.96, "Myanmar"],
  ["Thailand", 15.87, 100.99, "Thailand"],
  ["Vietnam", 14.06, 108.28, "Vietnam"],
  ["Philippines", 12.88, 121.77, "Philippines"],
  ["Indonesia", -0.79, 113.92, "Indonesia"],
  ["Malaysia", 4.21, 101.98, "Malaysia"],
  ["Taiwan", 23.7, 121.0, "Taiwan"],
  ["China", 35.86, 104.2, "China"],
  ["North Korea", 40.34, 127.51, "North Korea"],
  ["South Korea", 35.91, 127.77, "South Korea"],
  ["Japan", 36.2, 138.25, "Japan"],
  ["Turkey", 38.96, 35.24, "Turkey"],
  ["Armenia", 40.07, 45.04, "Armenia"],
  ["Azerbaijan", 40.14, 47.58, "Azerbaijan"],
  ["Georgia", 42.32, 43.36, "Georgia"],
  ["Serbia", 44.02, 20.92, "Serbia"],
  ["Kosovo", 42.6, 20.9, "Kosovo"],
  ["Bosnia", 43.92, 17.68, "Bosnia and Herzegovina"],
  ["Venezuela", 6.42, -66.59, "Venezuela"],
  ["Colombia", 4.57, -74.3, "Colombia"],
  ["Mexico", 23.63, -102.55, "Mexico"],
  ["Haiti", 18.97, -72.29, "Haiti"],
  ["Cuba", 21.52, -77.78, "Cuba"],
  ["United States", 39.83, -98.58, "United States"],
  ["United Kingdom", 54.7, -3.44, "United Kingdom"],
  ["Germany", 51.17, 10.45, "Germany"],
  ["France", 46.23, 2.21, "France"],
  ["Italy", 41.87, 12.57, "Italy"],
  ["Spain", 40.46, -3.75, "Spain"],
];

function buildRegex(name: string): RegExp {
  // Case-insensitive, whole-word match. Escape regex specials in the name.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const CITY_RE: Array<[RegExp, TextGeoHit]> = CITY_ENTRIES.map(([name, lat, lng, label]) => [
  buildRegex(name),
  { lat, lng, name: label, kind: "city" },
]);
const COUNTRY_RE: Array<[RegExp, TextGeoHit]> = COUNTRY_ENTRIES.map(([name, lat, lng, label]) => [
  buildRegex(name),
  { lat, lng, name: label, kind: "country" },
]);

/**
 * Return the first conflict-relevant place mentioned in `text` (cities first,
 * then countries). Returns null if nothing familiar is found.
 */
export function textGeoLookup(text: string): TextGeoHit | null {
  if (!text) return null;
  for (const [re, hit] of CITY_RE) if (re.test(text)) return hit;
  for (const [re, hit] of COUNTRY_RE) if (re.test(text)) return hit;
  return null;
}

/** Deterministic small lat/lng jitter so that many events at one centroid don't overlap exactly. */
export function jitterLatLng(seed: string, lat: number, lng: number): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h & 0xffff) / 0xffff;
  const v = ((h >>> 16) & 0xffff) / 0xffff;
  const r = 0.2 + u * 0.6; // degrees
  const t = v * Math.PI * 2;
  return {
    lat: Math.max(-85, Math.min(85, lat + Math.cos(t) * r * 0.35)),
    lng: lng + Math.sin(t) * r * 0.45,
  };
}
