export type GlobeSource =
  | "acled"
  | "firms"
  | "aisstream"
  | "celestrak"
  | "n2yo"
  | "vesselfinder"
  | "gdelt"
  | "liveuamap"
  | "perigon"
  | "ai"
  | "thenewsapi";

export type GlobeCategory = "conflict" | "fire" | "satellite" | "vessel" | "news" | "alert";

export interface GlobeEntity {
  id: string;
  source: GlobeSource;
  category: GlobeCategory;
  subcategory?: string;
  label?: string;
  lat: number;
  lon: number;
  alt?: number;
  timestamp: string;
  confidence?: number;
  speed?: number;
  heading?: number;
  metadata: Record<string, any>;
}

export interface SourceQuery {
  region?: string;
  from?: string;
  to?: string;
  bbox?: [number, number, number, number];
  keyword?: string;
  limit?: number;
  /**
   * ISO 639-1 codes, e.g. ["en","es"].
   * Omitted: adapters default news to English.
   * Empty array: no language restriction (all languages).
   */
  languages?: string[];
  /**
   * When true (default), Perigon/GDELT use region-aware conflict/security search terms.
   * When false, GDELT uses broader topics; Perigon omits `q` unless `keyword` is set.
   */
  conflictNews?: boolean;
}

