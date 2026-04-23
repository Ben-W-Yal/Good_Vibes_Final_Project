import { z } from "zod";
import { withCache } from "../lib/cache";
import type { SourceAdapter } from "./provider";
import type { GlobeEntity, SourceQuery } from "../types/globe";

const DEFAULT_BASE = "https://api.thenewsapi.com/v1";
const DOC_URL = "https://www.thenewsapi.com/documentation";

const articleSchema = z
  .object({
    uuid: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    snippet: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    image_url: z.string().optional().nullable(),
    language: z.string().optional().nullable(),
    published_at: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    locale: z.string().optional().nullable(),
    categories: z.array(z.string()).optional().nullable(),
  })
  .passthrough();

const topResponseSchema = z
  .object({
    data: z.union([z.array(articleSchema), z.record(z.array(articleSchema))]).optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

type ThenewsArticle = z.infer<typeof articleSchema>;

function toTheNewsApiDate(input: string): string {
  const t = new Date(input);
  if (Number.isNaN(t.getTime())) return new Date().toISOString().slice(0, 10);
  return t.toISOString().slice(0, 10);
}

function localeCentroid(locale?: string | null): { lat: number; lon: number } {
  const l = (locale || "").toLowerCase();
  if (l === "us") return { lat: 39.83, lon: -98.58 };
  if (l === "gb") return { lat: 55.37, lon: -3.43 };
  if (l === "ca") return { lat: 56.13, lon: -106.35 };
  if (l === "au") return { lat: -25.27, lon: 133.78 };
  if (l === "fr") return { lat: 46.22, lon: 2.21 };
  if (l === "de") return { lat: 51.17, lon: 10.45 };
  if (l === "ru") return { lat: 61.52, lon: 105.31 };
  if (l === "cn") return { lat: 35.86, lon: 104.2 };
  if (l === "in") return { lat: 20.59, lon: 78.96 };
  if (l === "br") return { lat: -14.23, lon: -51.92 };
  return { lat: 20, lon: 0 };
}

function flattenArticles(data: z.infer<typeof topResponseSchema>["data"]): ThenewsArticle[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const out: ThenewsArticle[] = [];
  for (const arr of Object.values(data)) {
    out.push(...arr);
  }
  return out;
}

function normalize(a: ThenewsArticle, idx: number): GlobeEntity | null {
  const title = typeof a.title === "string" ? a.title.trim() : "";
  const url = typeof a.url === "string" ? a.url.trim() : "";
  if (!title || !url) return null;
  const id = (typeof a.uuid === "string" && a.uuid.trim()) || `thenewsapi-${idx}-${url}`;
  const c = localeCentroid(a.locale);
  const domain = typeof a.source === "string" ? a.source : "thenewsapi";
  return {
    id,
    source: "thenewsapi",
    category: "news",
    subcategory: domain,
    label: title,
    lat: c.lat,
    lon: c.lon,
    timestamp:
      typeof a.published_at === "string" && a.published_at.trim()
        ? a.published_at
        : new Date().toISOString(),
    confidence: 0.45,
    metadata: {
      sourceUrl: url,
      sourceName: domain,
      originalTitle: title,
      originalText:
        (typeof a.description === "string" && a.description) ||
        (typeof a.snippet === "string" && a.snippet) ||
        "",
      imageUrl: typeof a.image_url === "string" ? a.image_url : undefined,
      region: typeof a.locale === "string" ? a.locale.toUpperCase() : "Global",
      locale: a.locale,
      categories: a.categories ?? [],
      approximateGeo: true,
      providerDoc: DOC_URL,
    },
  };
}

export const thenewsapiAdapter: SourceAdapter = {
  source: "thenewsapi",
  enabled() {
    return Boolean(process.env.THENEWSAPI_API_TOKEN?.trim());
  },
  async fetch(query?: SourceQuery): Promise<GlobeEntity[]> {
    if (!this.enabled()) return [];
    const token = process.env.THENEWSAPI_API_TOKEN!.trim();
    const base = (process.env.THENEWSAPI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
    const limit = Math.min(25, Math.max(5, query?.limit ?? 20));
    const from = toTheNewsApiDate(query?.from ?? new Date(Date.now() - 24 * 3_600_000).toISOString());
    const to = toTheNewsApiDate(query?.to ?? new Date().toISOString());

    const params = new URLSearchParams();
    params.set("api_token", token);
    params.set("limit", String(limit));
    params.set("published_after", from);
    params.set("published_before", to);
    const userQ = query?.keyword?.trim();
    if (userQ) params.set("search", userQ);
    const langs = query?.languages;
    if (langs && langs.length > 0) {
      params.set("language", langs.join(","));
    }
    if (query?.region && !/global/i.test(query.region)) {
      params.set("locale", query.region.toLowerCase());
    }

    const url = `${base}/news/top?${params.toString()}`;
    return withCache(`thenewsapi:${url}`, 45_000, async () => {
      const requestedLangs = new Set(
        (query?.languages ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean),
      );

      async function fetchRows(searchParams: URLSearchParams): Promise<GlobeEntity[]> {
        const reqUrl = `${base}/news/top?${searchParams.toString()}`;
        const res = await fetch(reqUrl, { headers: { Accept: "application/json" } });
        if (!res.ok) {
          throw new Error(`thenewsapi request failed: ${res.status}`);
        }
        const raw: unknown = await res.json();
        const parsed = topResponseSchema.parse(raw);
        let rows = flattenArticles(parsed.data);
        if (requestedLangs.size > 0) {
          rows = rows.filter((r) => {
            const lang = typeof r.language === "string" ? r.language.trim().toLowerCase() : "";
            return Boolean(lang) && requestedLangs.has(lang);
          });
        }
        const out: GlobeEntity[] = [];
        let i = 0;
        for (const r of rows) {
          const n = normalize(r, i++);
          if (n) out.push(n);
        }
        return out;
      }

      const attempts: URLSearchParams[] = [new URLSearchParams(params)];

      // Keep the selected language strict; only relax location/date constraints.
      const withoutLocale = new URLSearchParams(params);
      withoutLocale.delete("locale");
      attempts.push(withoutLocale);

      const unboundedRecentTop = new URLSearchParams(withoutLocale);
      unboundedRecentTop.delete("published_after");
      unboundedRecentTop.delete("published_before");
      attempts.push(unboundedRecentTop);

      let lastRows: GlobeEntity[] = [];
      for (const attempt of attempts) {
        const rows = await fetchRows(attempt);
        lastRows = rows;
        if (rows.length > 0) return rows;
      }
      return lastRows;
    });
  },
};

