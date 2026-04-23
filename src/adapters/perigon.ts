import { z } from "zod";
import { withCache } from "../lib/cache";
import { fetchWithRetry } from "../lib/fetchers";
import { perigonConflictSearchQuery } from "../lib/conflictNewsQuery";
import type { SourceAdapter } from "./provider";
import type { GlobeEntity, SourceQuery } from "../types/globe";

const DEFAULT_BASE = "https://api.perigon.io";

/** Do not pass these as `country=` — broad regions, not Perigon country filters. */
const REGION_NOT_COUNTRY = new Set(
  ["middle east", "asia", "africa", "americas", "europe", "global", "oceania", "world"].map((s) =>
    s.toLowerCase(),
  ),
);

const COUNTRY_CENTROID: Record<string, [number, number]> = {
  Ukraine: [48.38, 31.17],
  Russia: [61.52, 105.32],
  "United States": [39.83, -98.58],
  USA: [39.83, -98.58],
  US: [39.83, -98.58],
  China: [35.86, 104.2],
  Israel: [31.05, 34.85],
  Iran: [32.43, 53.69],
  "United Kingdom": [55.38, -3.44],
  UK: [55.38, -3.44],
  France: [46.23, 2.21],
  Germany: [51.16, 10.45],
  Poland: [51.92, 19.13],
  Syria: [34.8, 39.0],
  Iraq: [33.22, 43.68],
  India: [20.59, 78.96],
  Brazil: [-14.24, -51.93],
  Mexico: [23.63, -102.55],
  Japan: [36.2, 138.25],
  "South Korea": [35.91, 127.77],
  Taiwan: [23.7, 121.0],
  Australia: [-25.27, 133.78],
  Canada: [56.13, -106.35],
  Turkey: [38.96, 35.24],
  Egypt: [26.82, 30.8],
  "Saudi Arabia": [23.89, 45.08],
  Afghanistan: [33.94, 67.71],
  Pakistan: [30.38, 69.35],
  Lebanon: [33.85, 35.86],
  Yemen: [15.55, 48.52],
  Sudan: [12.86, 30.22],
  Ethiopia: [9.15, 40.49],
  Nigeria: [9.08, 8.68],
  "South Africa": [-30.56, 22.94],
};

const coordinatesSchema = z.object({
  lat: z.number().optional().nullable(),
  lon: z.number().optional().nullable(),
});

const articleSchema = z
  .object({
    articleId: z.union([z.string(), z.number()]).optional().nullable(),
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    pubDate: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    score: z.number().optional().nullable(),
    source: z
      .object({
        domain: z.string().optional().nullable(),
        location: z
          .object({
            country: z.string().optional().nullable(),
            city: z.string().optional().nullable(),
            coordinates: coordinatesSchema.optional().nullable(),
          })
          .optional()
          .nullable(),
      })
      .optional()
      .nullable(),
    places: z
      .array(
        z.object({
          coordinates: coordinatesSchema.optional().nullable(),
        }),
      )
      .optional()
      .nullable(),
  })
  .passthrough();

const searchResponseSchema = z.object({
  status: z.number().optional(),
  numResults: z.number().optional(),
  articles: z.array(articleSchema).optional().default([]),
});

type PerigonArticle = z.infer<typeof articleSchema>;

const COUNTRY_CENTROID_LOWER = new Map<string, [number, number]>(
  Object.entries(COUNTRY_CENTROID).map(([k, v]) => [k.toLowerCase(), v]),
);

function approxCoordsFromSeed(seed: string): { lat: number; lon: number } {
  let a = 0;
  let b = 0;
  for (let i = 0; i < seed.length; i++) {
    a = (a + seed.charCodeAt(i) * (i + 1)) % 10007;
    b = (b + seed.charCodeAt(i) * (i + 2)) % 10009;
  }
  const lat = (a / 10007) * 170 - 85;
  const lon = (b / 10009) * 360 - 180;
  return { lat: Math.max(-85, Math.min(85, lat)), lon };
}

function coordsForArticle(a: PerigonArticle): { lat: number; lon: number; approximate: boolean } {
  const sl = a.source?.location?.coordinates;
  if (sl?.lat != null && sl?.lon != null && Number.isFinite(sl.lat) && Number.isFinite(sl.lon)) {
    return { lat: sl.lat, lon: sl.lon, approximate: false };
  }
  for (const p of a.places ?? []) {
    const c = p.coordinates;
    if (c?.lat != null && c?.lon != null && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
      return { lat: c.lat, lon: c.lon, approximate: false };
    }
  }
  const countryRaw =
    (typeof a.country === "string" && a.country) ||
    (typeof a.source?.location?.country === "string" && a.source.location.country);
  if (countryRaw) {
    const key = countryRaw.trim().toLowerCase();
    const hit = COUNTRY_CENTROID[countryRaw.trim()] ?? COUNTRY_CENTROID_LOWER.get(key);
    if (hit) return { lat: hit[0], lon: hit[1], approximate: true };
  }
  const seed = String(a.articleId ?? a.url ?? a.title ?? "article");
  const ap = approxCoordsFromSeed(seed);
  return { lat: ap.lat, lon: ap.lon, approximate: true };
}

function normalizeArticle(a: PerigonArticle): GlobeEntity | null {
  const rawId = a.articleId ?? a.url;
  if (rawId == null && !(typeof a.title === "string" && a.title.trim())) return null;
  const id = rawId != null ? String(rawId) : `title:${String(a.title).slice(0, 120)}`;

  const coords = coordsForArticle(a);
  const pub = a.pubDate ?? new Date().toISOString();
  const domain = a.source?.domain ?? "news";
  const region =
    [a.source?.location?.city, a.source?.location?.country].filter(Boolean).join(", ") ||
    (typeof a.country === "string" ? a.country : "Global");

  return {
    id,
    source: "perigon",
    category: "news",
    subcategory: domain,
    label: a.title ?? "News article",
    lat: coords.lat,
    lon: coords.lon,
    timestamp: pub,
    confidence: coords.approximate
      ? 0.35
      : typeof a.score === "number"
        ? Math.min(0.95, Math.max(0.2, a.score))
        : 0.55,
    metadata: {
      originalTitle: a.title,
      originalText: a.description ?? a.summary,
      sourceUrl: a.url ?? `https://${domain}`,
      region,
      perigonDomain: domain,
      approximateGeo: coords.approximate,
    },
  };
}

export const perigonAdapter: SourceAdapter = {
  source: "perigon",
  enabled() {
    return Boolean(process.env.PERIGON_API_KEY?.trim());
  },
  async fetch(query?: SourceQuery): Promise<GlobeEntity[]> {
    if (!this.enabled()) return [];

    const base = (process.env.PERIGON_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
    const key = process.env.PERIGON_API_KEY as string;

    const from =
      query?.from ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = query?.to ?? new Date().toISOString();
    const size = Math.min(50, Math.max(5, query?.limit ?? 30));

    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("sortBy", "date");
    params.set("size", String(size));

    let languages: string[];
    const qLang = query?.languages;
    if (qLang === undefined) {
      languages = (process.env.PERIGON_LANGUAGES ?? "en")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (languages.length === 0) languages = ["en"];
    } else if (qLang.length === 0) {
      languages = [];
    } else {
      languages = qLang.map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
    for (const lang of languages) {
      params.append("language", lang);
    }

    const userQ = query?.keyword?.trim();
    const conflictOn = query?.conflictNews !== false;
    if (userQ) {
      params.set("q", userQ);
    } else if (conflictOn) {
      params.set("q", perigonConflictSearchQuery(query?.region));
    }
    const regionRaw = query?.region?.trim();
    if (regionRaw) {
      const r = regionRaw.toLowerCase();
      if (!REGION_NOT_COUNTRY.has(r) && !r.includes(",")) {
        params.append("country", regionRaw);
      }
    }

    const url = `${base}/v1/articles/all?${params.toString()}`;

    return withCache(`perigon:${url}`, 45_000, async () => {
      const payload = await fetchPerigonJson(url, key);

      const out: GlobeEntity[] = [];
      for (const a of payload.articles) {
        const g = normalizeArticle(a);
        if (g) out.push(g);
      }
      return out;
    });
  },
};

async function fetchPerigonJson(url: string, apiKey: string): Promise<z.infer<typeof searchResponseSchema>> {
  const authModes: RequestInit[] = [
    { headers: { "x-api-key": apiKey, Accept: "application/json" } },
    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
  ];

  let lastStatus = 0;
  for (const init of authModes) {
    const res = await fetchWithRetry(url, init, 2);
    lastStatus = res.status;
    if (res.status === 401) continue;
    if (!res.ok) {
      throw new Error(`Perigon request failed: ${res.status}`);
    }
    const raw: unknown = await res.json();
    return searchResponseSchema.parse(raw);
  }

  throw new Error(
    `Perigon authentication failed (${lastStatus}). Check PERIGON_API_KEY and that the key is allowed for /v1/articles/all.`,
  );
}
