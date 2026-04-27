/**
 * Lightweight place inference from headlines (GDELT DOC, Perigon, etc.).
 * Cities are matched before countries so "Kyiv" beats "Ukraine".
 */

export interface TextGeoHit {
  lat: number;
  lng: number;
  name: string;
  kind: "city" | "country";
}

/** Finer scatter near a known place; `region` spreads stacks that only have a huge country centroid. */
export type GeoJitterSpread = "place" | "region";

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
  ["Basra", 30.5, 47.78, "Basra, Iraq"],
  ["Erbil", 36.19, 44.01, "Erbil, Iraq"],
  ["Tehran", 35.69, 51.39, "Tehran, Iran"],
  ["Sanaa", 15.37, 44.19, "Sanaa, Yemen"],
  ["Aden", 12.79, 45.01, "Aden, Yemen"],
  ["Hodeidah", 14.8, 42.95, "Hodeidah, Yemen"],
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
  ["Washington DC", 38.9, -77.04, "Washington, DC"],
  ["Washington", 38.9, -77.04, "Washington, DC"],
  ["Pentagon", 38.87, -77.06, "The Pentagon, VA"],
  ["New York", 40.71, -74.01, "New York, NY"],
  ["Los Angeles", 34.05, -118.24, "Los Angeles, CA"],
  ["Chicago", 41.88, -87.63, "Chicago, IL"],
  ["Houston", 29.76, -95.37, "Houston, TX"],
  ["Miami", 25.76, -80.19, "Miami, FL"],
  ["Atlanta", 33.75, -84.39, "Atlanta, GA"],
  ["Dallas", 32.78, -96.8, "Dallas, TX"],
  ["Boston", 42.36, -71.06, "Boston, MA"],
  ["San Francisco", 37.77, -122.42, "San Francisco, CA"],
  ["Seattle", 47.61, -122.33, "Seattle, WA"],
  ["Phoenix", 33.45, -112.07, "Phoenix, AZ"],
  ["Denver", 39.74, -104.99, "Denver, CO"],
  ["Riyadh", 24.71, 46.68, "Riyadh, Saudi Arabia"],
  ["Dubai", 25.2, 55.27, "Dubai, UAE"],
  ["Doha", 25.29, 51.53, "Doha, Qatar"],
  ["Abu Dhabi", 24.45, 54.37, "Abu Dhabi, UAE"],
  ["Manama", 26.22, 50.58, "Manama, Bahrain"],
];

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

/** Headline hints that imply US / DC without the full country name. */
const PHRASE_ENTRIES: Array<[RegExp, TextGeoHit]> = [
  [/\bU\.S\.?\b/i, { lat: 38.9, lng: -77.04, name: "United States (inferred)", kind: "country" }],
  [/\bUS\b(?=\s+(?:strikes?|forces?|military|troops?|sanctions?|says?|warns?))/i, {
    lat: 38.9,
    lng: -77.04,
    name: "United States (inferred)",
    kind: "country",
  }],
  [/\bWhite\s+House\b/i, { lat: 38.9, lng: -77.04, name: "White House", kind: "city" }],
  [/\bCENTCOM\b/i, { lat: 26.0, lng: 50.0, name: "CENTCOM / Gulf (approx.)", kind: "city" }],
  [/\bRed\s+Sea\b/i, { lat: 20.0, lng: 38.0, name: "Red Sea", kind: "city" }],
  [/\bPersian\s+Gulf\b/i, { lat: 26.5, lng: 52.0, name: "Persian Gulf", kind: "city" }],
];

function buildRegex(name: string): RegExp {
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

export function textGeoLookup(text: string): TextGeoHit | null {
  if (!text) return null;
  for (const [re, hit] of CITY_RE) if (re.test(text)) return hit;
  for (const [re, hit] of PHRASE_ENTRIES) if (re.test(text)) return hit;
  for (const [re, hit] of COUNTRY_RE) if (re.test(text)) return hit;
  return null;
}

export function jitterLatLng(
  seed: string,
  lat: number,
  lng: number,
  spread: GeoJitterSpread = "place",
): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h & 0xffff) / 0xffff;
  const v = ((h >>> 16) & 0xffff) / 0xffff;
  const t = v * Math.PI * 2;
  const rMin = spread === "region" ? 0.55 : 0.18;
  const rSpan = spread === "region" ? 3.4 : 0.55;
  const r = rMin + u * rSpan;
  const latScale = spread === "region" ? 0.58 : 0.35;
  const lngScale = spread === "region" ? 0.68 : 0.45;
  return {
    lat: Math.max(-85, Math.min(85, lat + Math.cos(t) * r * latScale)),
    lng: lng + Math.sin(t) * r * lngScale,
  };
}
