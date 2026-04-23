/** ISO 639-1 → GDELT DOC `sourcelang:` token (lowercase English name). */
export const ISO_TO_GDELT_SOURCELANG: Record<string, string> = {
  en: "english",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  pt: "portuguese",
  ru: "russian",
  ar: "arabic",
  zh: "chinese",
  ja: "japanese",
  ko: "korean",
  uk: "ukrainian",
  pl: "polish",
  tr: "turkish",
  hi: "hindi",
  id: "indonesian",
  nl: "dutch",
  fa: "persian",
  he: "hebrew",
  sv: "swedish",
  no: "norwegian",
  da: "danish",
  fi: "finnish",
  el: "greek",
  ro: "romanian",
  hu: "hungarian",
  cs: "czech",
};

/**
 * GDELT: append sourcelang constraint. Empty list = no language filter (all).
 * See https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/ (sourcelang operator).
 */
export function gdeltLanguageQueryClause(isoCodes: string[]): string {
  if (isoCodes.length === 0) return "";
  const parts = isoCodes.map((iso) => {
    const k = iso.trim().toLowerCase();
    const g = ISO_TO_GDELT_SOURCELANG[k] ?? k;
    return `sourcelang:${g}`;
  });
  if (parts.length === 1) return parts[0];
  return `(${parts.join(" OR ")})`;
}
