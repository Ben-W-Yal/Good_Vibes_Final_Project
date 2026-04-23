import { withCache } from "../lib/cache";
import { dedupeNearIdentical } from "../lib/dedupe";
import { fetchWithRetry } from "../lib/fetchers";
import { withinBbox } from "../lib/geo";
import type { SourceAdapter } from "./provider";
import type { GlobeEntity, SourceQuery } from "../types/globe";

function mapLiveCategory(eventType?: string): GlobeEntity["category"] {
  const t = (eventType || "").toLowerCase();
  if (t.includes("alert") || t.includes("warning")) return "alert";
  if (t.includes("news")) return "news";
  return "conflict";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in row) return row[k];
    const hit = Object.keys(row).find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit) return row[hit];
  }
  return undefined;
}

function coerceTimestamp(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const attrs = row.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    return { ...row, ...(attrs as Record<string, unknown>) };
  }
  return row;
}

/** Pull a list of event-like items from common API / GeoJSON envelopes. */
function extractItems(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  if (o.type === "FeatureCollection" && Array.isArray(o.features)) {
    return o.features;
  }
  const listKeys = ["events", "data", "results", "items", "rows", "records", "content", "list", "payload", "nodes"];
  for (const k of listKeys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of listKeys) {
      const v = d[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function coordsFromPointGeometry(g: unknown): [number, number] | null {
  if (!g || typeof g !== "object") return null;
  const geo = g as { type?: string; coordinates?: unknown };
  if (geo.type !== "Point" || !Array.isArray(geo.coordinates)) return null;
  const c = geo.coordinates;
  const lon = num(c[0]);
  const lat = num(c[1]);
  if (lat == null || lon == null) return null;
  return [lon, lat];
}

function itemToEntity(item: unknown, index: number): GlobeEntity | null {
  if (item === null || typeof item !== "object") return null;

  const o = item as Record<string, unknown>;

  // GeoJSON Feature
  if (o.type === "Feature") {
    const props =
      o.properties && typeof o.properties === "object" && !Array.isArray(o.properties)
        ? (o.properties as Record<string, unknown>)
        : {};
    let lon: number | null = null;
    let lat: number | null = null;
    const fromPoint = coordsFromPointGeometry(o.geometry);
    if (fromPoint) {
      lon = fromPoint[0];
      lat = fromPoint[1];
    } else {
      lat = num(pick(props, "lat", "latitude"));
      lon = num(pick(props, "lon", "lng", "longitude"));
    }
    if (lat == null || lon == null) return null;
    const idRaw = o.id ?? props.id ?? props.event_id ?? index;
    const id = String(idRaw ?? `f-${index}`);
    const title =
      str(pick(props, "title", "name", "headline", "summary")) ??
      str(pick(props, "text", "description"))?.slice(0, 120);
    const eventType = str(pick(props, "eventType", "event_type", "type", "category"));
    const ts = coerceTimestamp(
      pick(
        props,
        "timestamp",
        "time",
        "date",
        "published",
        "created_at",
        "created",
        "event_date",
        "updated",
      ),
    );
    return {
      id,
      source: "liveuamap",
      category: mapLiveCategory(eventType),
      subcategory: eventType,
      label: title,
      lat,
      lon,
      timestamp: ts,
      confidence: 0.55,
      metadata: {
        originalTitle: title,
        originalText: str(pick(props, "text", "description", "body")),
        sourceUrl: str(pick(props, "url", "link", "sourceUrl")),
        mediaUrl: str(pick(props, "mediaUrl", "image", "image_url")),
        region: str(pick(props, "region")),
        tags: Array.isArray(props.tags) ? props.tags : undefined,
        eventType,
      },
    };
  }

  const row = flatten(o);
  const lat =
    num(pick(row, "lat", "latitude", "y")) ??
    (Array.isArray(row.coordinates) ? num((row.coordinates as number[])[1]) : null);
  const lon =
    num(pick(row, "lon", "lng", "longitude", "x")) ??
    (Array.isArray(row.coordinates) ? num((row.coordinates as number[])[0]) : null);
  if (lat == null || lon == null) return null;

  const idRaw = pick(row, "id", "event_id", "nid", "uuid") ?? `row-${index}`;
  const title =
    str(pick(row, "title", "name", "headline")) ??
    str(pick(row, "text", "description"))?.slice(0, 120);
  const eventType = str(pick(row, "eventType", "event_type", "type", "category"));
  const ts = coerceTimestamp(
    pick(row, "timestamp", "time", "date", "published", "created_at", "created", "event_date"),
  );

  return {
    id: String(idRaw),
    source: "liveuamap",
    category: mapLiveCategory(eventType),
    subcategory: eventType,
    label: title,
    lat,
    lon,
    timestamp: ts,
    confidence: 0.55,
    metadata: {
      originalTitle: title,
      originalText: str(pick(row, "text", "description", "body")),
      sourceUrl: str(pick(row, "url", "link", "sourceUrl")),
      mediaUrl: str(pick(row, "mediaUrl", "image", "image_url")),
      region: str(pick(row, "region")),
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
      eventType,
    },
  };
}

type AuthMode = "bearer" | "query" | "header";

function resolveAuthMode(): AuthMode {
  const m = (process.env.LIVEUAMAP_AUTH ?? "query").toLowerCase().trim();
  if (m === "bearer" || m === "header") return m;
  return "query";
}

function normalizeBaseUrl(input: string): string {
  let s = input.trim().replace(/^\s*(GET|POST)\s+/i, "").trim();
  if (!s.endsWith("/") && !s.includes("?")) s = `${s}/`;
  return s;
}

/** Map UI region to the Liveuamap `country` value (adjust or override with LIVEUAMAP_COUNTRY). */
function defaultCountryFor(region?: string): string | undefined {
  if (!region?.trim()) return undefined;
  const r = region.trim().toLowerCase();
  if (r === "ukraine") return "ukraine";
  return undefined;
}

function buildRequestUrl(baseUrl: string, query: SourceQuery): URL {
  const endpoint = new URL(normalizeBaseUrl(baseUrl));
  const minimal = process.env.LIVEUAMAP_MINIMAL_QUERY?.trim() === "1";

  const country =
    process.env.LIVEUAMAP_COUNTRY?.trim() ||
    defaultCountryFor(query.region) ||
    "ukraine";
  const count = query.limit != null ? Math.min(200, Math.max(1, query.limit)) : 50;

  endpoint.searchParams.set("country", country);
  endpoint.searchParams.set("count", String(count));

  if (!minimal && query.keyword?.trim()) {
    endpoint.searchParams.set("q", query.keyword.trim());
  }

  return endpoint;
}

function authHeaders(mode: AuthMode, key: string): HeadersInit {
  if (mode === "query") return { Accept: "application/json" };
  if (mode === "header") return { Accept: "application/json", "X-API-Key": key };
  return { Accept: "application/json", Authorization: `Bearer ${key}` };
}

function applyQueryKey(url: URL, key: string): void {
  const param = process.env.LIVEUAMAP_QUERY_PARAM?.trim() || "access_token";
  url.searchParams.set(param, key);
}

export const liveuamapAdapter: SourceAdapter = {
  source: "liveuamap",
  enabled() {
    return Boolean(process.env.LIVEUAMAP_API_KEY?.trim() && process.env.LIVEUAMAP_BASE_URL?.trim());
  },

  async fetch(query?: SourceQuery): Promise<GlobeEntity[]> {
    if (!this.enabled()) {
      return [];
    }

    const baseUrl = process.env.LIVEUAMAP_BASE_URL!.trim();
    const key = process.env.LIVEUAMAP_API_KEY!.trim();
    const mode = resolveAuthMode();
    const url = buildRequestUrl(baseUrl, query ?? {});

    if (mode === "query") {
      applyQueryKey(url, key);
    }

    const cacheKey = `liveuamap:v4:${mode}:${url.toString()}`;

    return withCache(cacheKey, 60_000, async () => {
      const res = await fetchWithRetry(url.toString(), {
        headers: authHeaders(mode, key),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Liveuamap HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        throw new Error("Liveuamap response was not JSON");
      }

      const items = extractItems(raw);
      if (items.length === 0 && raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const keys = Object.keys(o);
        console.warn("[liveuamap] No events array/GeoJSON found; top-level keys:", keys);

        const apiError =
          o.success === false ||
          typeof o.error === "string" ||
          typeof o.error_code === "string" ||
          typeof o.error_code === "number" ||
          (typeof o.message === "string" &&
            !Array.isArray(o.data) &&
            !Array.isArray(o.events) &&
            !Array.isArray(o.features));

        if (apiError) {
          const msg =
            (typeof o.message === "string" && o.message) ||
            (typeof o.error === "string" && o.error) ||
            "Liveuamap API error";
          const code =
            o.error_code != null ? ` (error_code=${String(o.error_code)})` : "";
          throw new Error(`Liveuamap API: ${msg}${code}`);
        }

        if (process.env.LIVEUAMAP_DEBUG?.trim() === "1") {
          try {
            const preview = JSON.stringify(raw).slice(0, 2500);
            console.warn("[liveuamap] LIVEUAMAP_DEBUG response preview:", preview);
          } catch {
            /* ignore */
          }
        }
      }

      const out: GlobeEntity[] = [];
      items.forEach((item, i) => {
        const g = itemToEntity(item, i);
        if (g) out.push(g);
      });

      const filtered = out.filter((e) => withinBbox(e.lat, e.lon, query?.bbox));
      return dedupeNearIdentical(filtered);
    });
  },
};
