import { z } from "zod";
import { cacheGet, cacheSet } from "../lib/cache";
import { gdeltConflictTopicQuery, gdeltGeneralTopicQuery } from "../lib/conflictNewsQuery";
import { gdeltLanguageQueryClause } from "../lib/newsLanguages";
import type { SourceAdapter } from "./provider";
import type { GlobeEntity, SourceQuery } from "../types/globe";

/**
 * GDELT GEO 2.0 API — returns GeoJSON FeatureCollection where each Point feature
 * is a real location mentioned in matching articles (not the publisher country).
 * Docs: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
 */
const DEFAULT_GEO = "https://api.gdeltproject.org/api/v2/geo/geo";
/** Fallback: the DOC artlist endpoint (publisher country only) if GEO is unreachable. */
const DEFAULT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

/** Feature.properties shape returned by GDELT GEO 2.0 PointData mode. */
const geoFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]).or(z.array(z.number())),
  }),
  properties: z
    .object({
      name: z.string().optional(),
      count: z.union([z.number(), z.string()]).optional(),
      html: z.string().optional(),
      shareimage: z.string().optional(),
    })
    .passthrough(),
});

const geoCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(geoFeatureSchema).optional(),
});

const docSchema = z.object({
  articles: z.array(z.record(z.unknown())).optional(),
});

/**
 * Combine topic + optional GDELT sourcelang clause. Default: English only when
 * `languages` omitted. GDELT rejects nested parens; we keep output single-level.
 */
function buildGdeltQuery(
  region: string | undefined,
  languages: string[] | undefined,
  conflictNews: boolean,
): string {
  const topic = (
    conflictNews ? gdeltConflictTopicQuery(region) : gdeltGeneralTopicQuery(region)
  ).trim();
  let langCodes: string[];
  if (languages === undefined) langCodes = ["en"];
  else if (languages.length === 0) langCodes = [];
  else langCodes = languages;

  const langClause = gdeltLanguageQueryClause(langCodes);
  if (!langClause) return topic;
  return `${topic} ${langClause}`;
}

/**
 * GDELT timespan — accepts Nh / Nd. Clamp 1h..7d for recency focus.
 * We widen the floor to 24h because anything narrower tends to return 0
 * results from the free GDELT DOC API for conflict queries (its indexing
 * pipeline lags ~several hours on many publishers).
 */
function timespanFromQuery(query?: SourceQuery): string {
  const fromT = query?.from ? new Date(query.from).getTime() : Date.now() - 24 * 3_600_000;
  const toT = query?.to ? new Date(query.to).getTime() : Date.now();
  let spanH = Math.max(24, Math.ceil((toT - fromT) / 3_600_000));
  spanH = Math.min(spanH, 168);
  if (spanH >= 72) return `${Math.min(7, Math.max(1, Math.round(spanH / 24)))}d`;
  return `${spanH}h`;
}

function hashId(src: string): string {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Process-wide minimum spacing between GDELT calls — upstream asks for ≥5s between requests. */
const GDELT_MIN_GAP_MS = 6_500;
let gdeltNextAllowedAt = 0;
async function gdeltThrottle(): Promise<void> {
  const now = Date.now();
  const waitMs = gdeltNextAllowedAt - now;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  gdeltNextAllowedAt = Math.max(Date.now(), gdeltNextAllowedAt) + GDELT_MIN_GAP_MS;
}

function looksLikeGdeltRateLimitText(text: string): boolean {
  const s = text.trim().slice(0, 80).toLowerCase();
  return s.startsWith("please limit requests");
}

function looksLikeGdeltQueryErrorText(text: string): boolean {
  const s = text.trim().slice(0, 80).toLowerCase();
  return s.startsWith("parenthes") || s.startsWith("your query");
}

interface GdeltArticleRef {
  title: string;
  url: string;
  domain?: string;
  date?: string;
  thumbnail?: string;
}

/**
 * GEO 2.0 PointData returns the matching article list as an HTML blob in
 * `properties.html`, structured roughly as:
 *   Loc Name<BR>
 *   <A HREF="url">Title</A> (Domain; YYYYMMDDTHHMMSSZ)<BR>
 *   ... up to 5 articles ...
 * We parse that minimally to produce a structured reference list for the UI.
 */
function parseGeoArticlesHtml(html: string | undefined): GdeltArticleRef[] {
  if (!html) return [];
  const out: GdeltArticleRef[] = [];
  const anchorRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>(\s*\(([^)]*)\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const url = m[1].trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const paren = (m[4] ?? "").trim();
    const parts = paren.split(";").map((p) => p.trim()).filter(Boolean);
    const domain = parts[0];
    const date = parts[1];
    out.push({ title: title || url, url, domain, date });
    if (out.length >= 5) break;
  }
  return out;
}

function parseSeeDate(seen: unknown): string {
  if (typeof seen !== "string" || seen.length < 15) return new Date().toISOString();
  const y = seen.slice(0, 4);
  const mo = seen.slice(4, 6);
  const d = seen.slice(6, 8);
  if (seen[8] !== "T") return new Date().toISOString();
  const rest = seen.slice(9).replace(/Z$/, "");
  const hh = rest.slice(0, 2) || "00";
  const mm = rest.slice(2, 4) || "00";
  const ss = rest.slice(4, 6) || "00";
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`;
}

async function fetchFromGeoEndpoint(
  query: string,
  timespan: string,
  maxrows: number,
): Promise<GlobeEntity[] | null> {
  const base = process.env.GDELT_GEO_BASE_URL?.trim() || DEFAULT_GEO;
  const params = new URLSearchParams({
    query,
    mode: "PointData",
    format: "GeoJSON",
    timespan,
    maxrows: String(maxrows),
  });
  const url = `${base}?${params.toString()}`;

  await gdeltThrottle();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/geo+json, application/json", "User-Agent": "GeoIntel/1.0" },
    });
  } catch (e) {
    console.warn("[gdelt] geo fetch network error:", (e as Error).message);
    return null;
  }

  if (res.status === 404) {
    // GEO endpoint occasionally returns 404 under heavy load or has moved; fall back to DOC.
    console.warn("[gdelt] geo endpoint 404 — falling back to DOC publisher-country geocoding");
    return null;
  }
  if (res.status === 429) {
    console.warn("[gdelt] geo rate-limited");
    return [];
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(`[gdelt] geo HTTP ${res.status}: ${txt.slice(0, 200)}`);
    return null;
  }

  const rawText = await res.text();
  if (looksLikeGdeltRateLimitText(rawText)) {
    console.warn("[gdelt] geo rate-limited (200 plain text)");
    return [];
  }
  if (looksLikeGdeltQueryErrorText(rawText)) {
    console.warn(`[gdelt] geo query rejected: ${rawText.slice(0, 120)}`);
    return [];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    // Sometimes an HTML error page comes back — treat as endpoint unavailable.
    if (rawText.trim().startsWith("<")) {
      console.warn("[gdelt] geo returned HTML — falling back to DOC");
      return null;
    }
    console.warn(`[gdelt] geo non-JSON body (${rawText.slice(0, 80)})`);
    return [];
  }

  const parsed = geoCollectionSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[gdelt] geo schema mismatch — falling back to DOC");
    return null;
  }

  const features = parsed.data.features ?? [];
  const out: GlobeEntity[] = [];
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f.properties ?? {};
    const name = typeof p.name === "string" ? p.name : "Reported location";
    const count = typeof p.count === "number" ? p.count : Number(p.count ?? 0);
    const articles = parseGeoArticlesHtml(p.html);
    if (articles.length === 0) continue; // no per-article links → nothing to display

    const primary = articles[0];
    const id = hashId(primary.url || `${name}:${lat}:${lon}`);
    const label = primary.title.slice(0, 200) || name;

    out.push({
      id,
      source: "gdelt",
      category: "news",
      subcategory: primary.domain || "News",
      label,
      lat,
      lon,
      timestamp: new Date().toISOString(),
      confidence: 0.6,
      metadata: {
        placeName: name,
        articleCount: Number.isFinite(count) ? count : articles.length,
        articles,
        sourceUrl: primary.url,
        originalTitle: primary.title,
        originalText: articles.map((a) => `• ${a.title}`).join("\n"),
        domain: primary.domain,
        preciseGeo: true,
      },
    });
  }
  return out;
}

async function fetchFromDocEndpoint(
  query: string,
  timespan: string,
  maxrec: number,
): Promise<GlobeEntity[]> {
  const { coordsForSourceCountry, jitterLatLng } = await import(
    "../lib/sourceCountryCentroids"
  );

  const base = process.env.GDELT_DOC_BASE_URL?.trim() || DEFAULT_DOC;
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxrec),
    timespan,
  });
  const url = `${base}?${params.toString()}`;

  await gdeltThrottle();
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "GeoIntel/1.0" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429 || looksLikeGdeltRateLimitText(t)) return [];
    throw new Error(`GDELT DOC HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const rawText = await res.text();
  if (looksLikeGdeltRateLimitText(rawText) || looksLikeGdeltQueryErrorText(rawText)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return [];
  }
  const parsed = docSchema.parse(raw);
  const articles = parsed.articles ?? [];
  const out: GlobeEntity[] = [];
  for (const a of articles) {
    const title = typeof a.title === "string" ? a.title : "";
    const artUrl = typeof a.url === "string" ? a.url : "";
    const sc = a.sourcecountry;
    const baseCoords = coordsForSourceCountry(sc);
    if (!baseCoords || !artUrl) continue;
    const id = hashId(artUrl);
    const { lat, lng } = jitterLatLng(artUrl, baseCoords.lat, baseCoords.lng);
    const iso = parseSeeDate(a.seendate);
    out.push({
      id,
      source: "gdelt",
      category: "news",
      subcategory: typeof a.domain === "string" ? a.domain : "News",
      label: title.slice(0, 200) || "GDELT article",
      lat,
      lon: lng,
      timestamp: iso,
      confidence: 0.5,
      metadata: {
        sourceUrl: artUrl,
        originalTitle: title,
        originalText: title,
        sourceCountry: sc,
        domain: a.domain,
        seendate: a.seendate,
        socialImage: typeof a.socialimage === "string" ? a.socialimage : undefined,
        preciseGeo: false,
      },
    });
  }
  return out;
}

export const gdeltAdapter: SourceAdapter = {
  source: "gdelt",
  enabled() {
    return process.env.GDELT_ENABLED !== "false" && process.env.GDELT_ENABLED !== "0";
  },

  async fetch(query?: SourceQuery): Promise<GlobeEntity[]> {
    if (!this.enabled()) return [];

    const maxRec = Math.min(120, Math.max(15, query?.limit ?? 60));
    const conflictOn = query?.conflictNews !== false;
    const q = buildGdeltQuery(query?.region, query?.languages, conflictOn);
    const ts = timespanFromQuery(query);
    const langKey =
      query?.languages === undefined
        ? "def:en"
        : query.languages.length === 0
          ? "all"
          : query.languages.slice().sort().join(",");
    const cacheKey = `gdelt:geo:v3:${q}:${ts}:${maxRec}:${langKey}:c${conflictOn ? 1 : 0}`;

    // Hand-rolled caching so we can apply a SHORTER TTL to empty responses.
    // GDELT's free endpoint aggressively rate-limits bursts from a single IP,
    // which causes GDELT to return an empty/plaintext response even though the
    // query itself is valid. If we cache that emptiness for 5 minutes, the UI
    // stays blank long after the throttle has cleared. 30s on empty gets us
    // back to fresh data quickly.
    const cached = cacheGet<GlobeEntity[]>(cacheKey);
    if (cached !== null) return cached;

    // Prefer the GEO endpoint (article-level locations). But the GEO endpoint
    // very often returns an empty FeatureCollection — either because the query
    // produced no articles with parseable in-text locations, or because of
    // upstream throttling. In that case we MUST still try DOC so the feed
    // isn't silently empty.
    const geoRows = await fetchFromGeoEndpoint(q, ts, maxRec);
    if (geoRows && geoRows.length > 0) {
      cacheSet(cacheKey, geoRows, 300_000);
      return geoRows;
    }

    try {
      const docRows = await fetchFromDocEndpoint(q, ts, maxRec);
      if (docRows.length > 0) {
        cacheSet(cacheKey, docRows, 300_000);
        return docRows;
      }
    } catch (e) {
      console.warn("[gdelt] DOC fallback failed:", (e as Error).message);
    }

    // Last resort: widen timespan to 3d / 7d in case the original window was
    // too narrow for GDELT's indexing pipeline. The GDELT DOC API reliably
    // has coverage going back several days for major topics.
    for (const widened of ["3d", "7d"]) {
      if (widened === ts) continue;
      try {
        const rows = await fetchFromDocEndpoint(q, widened, maxRec);
        if (rows.length > 0) {
          console.info(`[gdelt] recovered ${rows.length} rows via widened timespan=${widened}`);
          cacheSet(cacheKey, rows, 300_000);
          return rows;
        }
      } catch (e) {
        console.warn(`[gdelt] widened (${widened}) DOC failed:`, (e as Error).message);
      }
    }

    console.warn(
      "[gdelt] all attempts returned 0 rows — likely upstream rate limiting. Retrying in 30s.",
    );
    cacheSet(cacheKey, [] as GlobeEntity[], 30_000);
    return [];
  },
};
