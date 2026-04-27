import type { Express, Request, Response } from 'express';
import type { Server } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { liveuamapAdapter } from '../src/adapters/liveuamap';
import { perigonAdapter } from '../src/adapters/perigon';
import { thenewsapiAdapter } from '../src/adapters/thenewsapi';
import { acledAdapter } from '../src/adapters/acled';
import { getAcledDebugInfo } from '../src/adapters/acled';
import { gdeltAdapter } from '../src/adapters/gdelt';
import { fetchOpenSkyAircraft } from '../src/adapters/opensky';
import { fetchAirplanesLiveAircraft } from '../src/adapters/airplanesLive';
import { fetchAishubShips } from '../src/adapters/aishub';
import { fetchAisstreamShips } from '../src/adapters/aisstream';
import { fetchMarineTrafficShips } from '../src/adapters/marinetraffic';
import { fetchLiveSatellites } from '../src/adapters/satellites';
import {
  aircraftHexFromId,
  fetchFlightradar24Aircraft,
  flightradar24Enabled,
} from '../src/adapters/flightradar24';
import type { GlobeEntity } from '../src/types/globe';
import type { Aircraft, Ship, Satellite } from '../client/src/data/trackers';

type AnyRecord = Record<string, unknown>;

const DATA_DIR = path.resolve(process.cwd(), 'server/data');
const GDELT_CACHE_FILE = path.join(DATA_DIR, 'gdelt-cache.json');
const GDELT_CACHE_TTL_MS = 15 * 60_000;
const GDELT_STALE_FALLBACK_MS = 6 * 60 * 60_000;
const GDELT_ROUTE_FETCH_TIMEOUT_MS = 50_000;
const GDELT_ROUTE_MAX_LIMIT = Math.min(
  1000,
  Math.max(50, Number(process.env.GDELT_MAX_ROWS ?? 300) || 300),
);
const GDELT_ROUTE_MAX_TIMESPAN_DAYS = Math.min(
  90,
  Math.max(7, Number(process.env.GDELT_MAX_TIMESPAN_DAYS ?? 30) || 30),
);
const ACLED_ROUTE_MAX_LIMIT = Math.min(
  100_000,
  Math.max(5_000, Number(process.env.ACLED_MAX_ROWS ?? 50_000) || 50_000),
);
const gdeltRouteCache = new Map<string, { rows: GlobeEntity[]; updatedAtMs: number }>();
const gdeltInFlight = new Map<string, Promise<GlobeEntity[]>>();
const SATELLITE_INTEL_CACHE_TTL_MS = 6 * 60 * 60_000;
const satelliteIntelCache = new Map<string, { payload: SatelliteIntelPayload; updatedAtMs: number }>();
const TRACKER_INTEL_CACHE_TTL_MS = 6 * 60 * 60_000;
const trackerIntelCache = new Map<string, { payload: TrackerIntelPayload; updatedAtMs: number }>();

type GdeltRouteQuery = {
  region?: string;
  from?: string;
  to?: string;
  languages?: string[];
  conflictNews?: boolean;
  limit?: number;
};

type SatelliteIntelPayload = {
  summary: string;
  country?: string;
  operator?: string;
  launchDate?: string;
  launchVehicle?: string;
  launchSite?: string;
  yearsInOrbit?: string;
  purpose?: string;
  orbit?: string;
  confidence?: string;
  sources: { title: string; url: string }[];
  generatedAt: string;
  model?: string;
};

type TrackerIntelPayload = {
  summary: string;
  airline?: string;
  operator?: string;
  country?: string;
  registration?: string;
  modelOrClass?: string;
  origin?: string;
  destination?: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  flightStatus?: string;
  role?: string;
  owner?: string;
  flag?: string;
  built?: string;
  confidence?: string;
  sources: { title: string; url: string }[];
  generatedAt: string;
  model?: string;
};

function gdeltSpanHours(from?: string, to?: string): number {
  const toT = to ? new Date(to).getTime() : Date.now();
  const fromT = from ? new Date(from).getTime() : Date.now() - 24 * 3_600_000;
  if (!Number.isFinite(toT) || !Number.isFinite(fromT) || toT <= fromT) return 24;
  const hours = Math.ceil((toT - fromT) / 3_600_000);
  return Math.max(1, Math.min(24 * GDELT_ROUTE_MAX_TIMESPAN_DAYS, hours));
}

function gdeltCacheKey(query: GdeltRouteQuery): string {
  const region = (query.region ?? 'global').trim().toLowerCase() || 'global';
  const languages =
    query.languages === undefined
      ? 'def:en'
      : query.languages.length === 0
        ? 'all'
        : query.languages.slice().sort().join(',');
  const span = gdeltSpanHours(query.from, query.to);
  const conflict = query.conflictNews === false ? 'c0' : 'c1';
  return `gdelt-route:${region}:h${span}:${languages}:${conflict}`;
}

async function loadGdeltRouteCacheFromDisk(): Promise<void> {
  try {
    const txt = await fs.readFile(GDELT_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(txt) as {
      entries?: Array<{ key: string; updatedAtMs: number; rows: GlobeEntity[] }>;
    };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const now = Date.now();
    for (const e of entries) {
      if (!e || typeof e.key !== 'string' || !Array.isArray(e.rows)) continue;
      if (!Number.isFinite(e.updatedAtMs)) continue;
      if (now - e.updatedAtMs > GDELT_STALE_FALLBACK_MS) continue;
      gdeltRouteCache.set(e.key, { rows: e.rows, updatedAtMs: e.updatedAtMs });
    }
  } catch {
    // first boot/no cache file
  }
}

async function persistGdeltRouteCacheToDisk(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const entries = Array.from(gdeltRouteCache.entries())
      .sort((a, b) => b[1].updatedAtMs - a[1].updatedAtMs)
      .slice(0, 30)
      .map(([key, v]) => ({ key, updatedAtMs: v.updatedAtMs, rows: v.rows.slice(0, GDELT_ROUTE_MAX_LIMIT) }));
    await fs.writeFile(GDELT_CACHE_FILE, JSON.stringify({ entries }), 'utf8');
  } catch (e) {
    console.warn('[gdelt-cache] failed to persist cache file:', e);
  }
}

async function fetchAndCacheGdelt(query: GdeltRouteQuery): Promise<GlobeEntity[]> {
  const key = gdeltCacheKey(query);
  const existing = gdeltInFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const rows = await Promise.race([
      gdeltAdapter.fetch({
        region: query.region,
        from: query.from,
        to: query.to,
        limit: query.limit,
        languages: query.languages,
        conflictNews: query.conflictNews,
      }),
      new Promise<GlobeEntity[]>((_, reject) =>
        setTimeout(() => reject(new Error('GDELT route fetch timeout')), GDELT_ROUTE_FETCH_TIMEOUT_MS),
      ),
    ]);
    gdeltRouteCache.set(key, { rows, updatedAtMs: Date.now() });
    await persistGdeltRouteCacheToDisk();
    return rows;
  })();

  gdeltInFlight.set(key, task);
  try {
    return await task;
  } finally {
    gdeltInFlight.delete(key);
  }
}

/**
 * Look up the Gemini API key under any of the common env-var names we have seen in
 * this project's .env over time (including an old `GENINI_API_KEY` typo). First
 * non-empty, trimmed value wins.
 */
function resolveGeminiKey(): string {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.APP_GEMINI_API_KEY,
    process.env.GENINI_API_KEY, // legacy typo support
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Best-effort parse of a Gemini briefing payload. Gemini occasionally wraps
 * the JSON in ```json fences, truncates strings at the token ceiling, or emits
 * stray leading/trailing characters. This tries four strategies in order
 * before giving up: direct parse → strip markdown fences → slice first `{`…
 * last `}` → swap newlines inside strings for spaces. Returns null if every
 * attempt fails so the caller can degrade gracefully.
 */
function tryParseBriefingJson(raw: string): unknown | null {
  // 1) Strip markdown fences Gemini likes to add in grounded mode.
  const defenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // 2) Slice from first "{" to last "}" (drops stray preamble/postscript).
  const firstBrace = defenced.indexOf('{');
  const lastBrace = defenced.lastIndexOf('}');
  const sliced =
    firstBrace >= 0 && lastBrace > firstBrace
      ? defenced.slice(firstBrace, lastBrace + 1)
      : defenced;
  // 3) Repair literal newlines inside string values (a common Gemini quirk).
  const newlineRepaired = sliced.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match.replace(/\r?\n/g, ' '),
  );
  // 4) Auto-close truncated JSON: if Gemini hit MAX_TOKENS mid-object, we
  //    build a best-effort closure by truncating at the last complete value
  //    and balancing brackets.
  const repaired = (() => {
    const src = defenced;
    if (!src.startsWith('{')) return '';
    // Walk forward tracking strings + escapes, stop at last complete value.
    let inString = false;
    let escape = false;
    let depthCurly = 0;
    let depthBracket = 0;
    let lastSafeEnd = -1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depthCurly++;
      else if (ch === '}') depthCurly--;
      else if (ch === '[') depthBracket++;
      else if (ch === ']') depthBracket--;
      else if (ch === ',' && depthCurly === 1 && depthBracket === 0) lastSafeEnd = i;
    }
    if (lastSafeEnd < 0) return '';
    let candidate = src.slice(0, lastSafeEnd); // drop the trailing incomplete value
    // balance remaining open brackets
    const openCurly = (candidate.match(/{/g) || []).length - (candidate.match(/}/g) || []).length;
    const openBracket =
      (candidate.match(/\[/g) || []).length - (candidate.match(/\]/g) || []).length;
    candidate += ']'.repeat(Math.max(0, openBracket));
    candidate += '}'.repeat(Math.max(0, openCurly));
    return candidate;
  })();
  const attempts = [raw, defenced, sliced, newlineRepaired, repaired];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function extractNoradId(id?: string): string {
  const match = String(id ?? '').match(/\d{1,6}/);
  return match?.[0] ?? '';
}

function sanitizeSatelliteSources(
  rawSources: unknown,
  groundingChunks?: { web?: { uri?: string; title?: string } }[],
): { title: string; url: string }[] {
  const byUrl = new Map<string, { title: string; url: string }>();
  const add = (title?: unknown, url?: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const cleanedTitle =
      typeof title === 'string' && title.trim()
        ? title.trim().slice(0, 140)
        : new URL(url).hostname.replace(/^www\./, '');
    byUrl.set(url, { title: cleanedTitle, url });
  };

  if (Array.isArray(rawSources)) {
    for (const source of rawSources) {
      if (!source || typeof source !== 'object') continue;
      const s = source as { title?: unknown; url?: unknown };
      add(s.title, s.url);
    }
  }

  for (const chunk of groundingChunks ?? []) {
    add(chunk.web?.title, chunk.web?.uri);
  }

  return Array.from(byUrl.values()).slice(0, 6);
}

function fallbackSatelliteIntel(sat: Satellite, model?: string): SatelliteIntelPayload {
  const norad = extractNoradId(sat.id);
  return {
    summary:
      `${sat.name} is currently tracked from public TLE data as NORAD catalog ${norad || sat.id}. ` +
      `The app can propagate its current position and orbit, but the AI web lookup did not return a parseable open-source dossier for this request.`,
    country: sat.country,
    operator: sat.country && sat.country !== 'Unknown' ? `${sat.country} operator` : undefined,
    launchVehicle: undefined,
    launchSite: undefined,
    purpose: sat.category,
    orbit: sat.orbit,
    confidence: 'low',
    sources: sat.sourceUrl ? [{ title: sat.source, url: sat.sourceUrl }] : [],
    generatedAt: new Date().toISOString(),
    model,
  };
}

function fallbackTrackerIntel(
  kind: 'aircraft' | 'ships',
  tracker: Aircraft | Ship,
  model?: string,
): TrackerIntelPayload {
  if (kind === 'aircraft') {
    const aircraft = tracker as Aircraft;
    return {
      summary:
        `${aircraft.callsign} is shown from the live tracker feed as a ${aircraft.category} aircraft, ` +
        `reported as type ${aircraft.type} and associated with ${aircraft.country || 'an unknown country'}. ` +
        `The AI web lookup did not return a parseable open-source dossier for this request.`,
      operator: aircraft.carrier,
      country: aircraft.country,
      modelOrClass: aircraft.type,
      origin: undefined,
      destination: undefined,
      flightStatus: undefined,
      role: aircraft.category,
      confidence: 'low',
      sources: aircraft.sourceUrl ? [{ title: aircraft.source, url: aircraft.sourceUrl }] : [],
      generatedAt: new Date().toISOString(),
      model,
    };
  }

  const ship = tracker as Ship;
  return {
    summary:
      `${ship.name} is shown from the live tracker feed as a ${ship.category} ${ship.type} vessel ` +
      `flagged to ${ship.flag || 'an unknown flag state'}. The AI web lookup did not return a parseable open-source dossier for this request.`,
    country: ship.flag,
    flag: ship.flag,
    modelOrClass: ship.type,
    role: ship.category,
    confidence: 'low',
    sources: ship.sourceUrl ? [{ title: ship.source, url: ship.sourceUrl }] : [],
    generatedAt: new Date().toISOString(),
    model,
  };
}

/** Convert raw Gemini error blob (string or JSON) into a short, human-readable line. */
function formatGeminiError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const msg = parsed?.error?.message ?? parsed?.error?.status;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    // fall through
  }
  return raw.slice(0, 280);
}

function hostnameFromUrl(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u.slice(0, 60);
  }
}

function fallbackCoordsForCountry(country?: string): { lat: number; lon: number } {
  const c = (country || '').toLowerCase();
  if (c.includes('ukraine')) return { lat: 49.0, lon: 31.3 };
  if (c.includes('russia')) return { lat: 55.7, lon: 37.6 };
  if (c.includes('israel')) return { lat: 31.0, lon: 35.0 };
  if (c.includes('iran')) return { lat: 32.0, lon: 53.0 };
  if (c.includes('china')) return { lat: 35.8, lon: 104.1 };
  if (c.includes('united states')) return { lat: 39.8, lon: -98.6 };
  if (c.includes('brazil')) return { lat: -14.2, lon: -51.9 };
  return { lat: 20, lon: 0 };
}

function osmEmbedUrl(lat: number, lon: number, zoomDelta = 8): string {
  const d = Math.max(1, Math.min(20, zoomDelta));
  const minLon = Math.max(-180, lon - d);
  const maxLon = Math.min(180, lon + d);
  const minLat = Math.max(-85, lat - d * 0.6);
  const maxLat = Math.min(85, lat + d * 0.6);
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox,
  )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

function mapFocusFromRegions(
  regions: string[] | undefined,
  topic: string | undefined,
): { label: string; lat: number; lon: number; embedUrl: string } {
  const candidates = [...(regions ?? []), topic ?? ''].filter(Boolean);
  for (const c of candidates) {
    const center = fallbackCoordsForCountry(c);
    // If a specific region is unknown, fallbackCoordsForCountry returns world center.
    if (!(center.lat === 20 && center.lon === 0 && !/global|world/i.test(c))) {
      return {
        label: c,
        lat: center.lat,
        lon: center.lon,
        embedUrl: osmEmbedUrl(center.lat, center.lon),
      };
    }
  }
  return { label: 'Global', lat: 20, lon: 0, embedUrl: osmEmbedUrl(20, 0, 20) };
}

async function fetchCitationImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'GeoIntel/1.0 (+briefing visual extractor)',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await res.text();
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      const raw = m?.[1]?.trim();
      if (!raw) continue;
      try {
        const absolute = new URL(raw, url).toString();
        if (/^https?:\/\//i.test(absolute)) return absolute;
      } catch {
        // continue
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
/**
 * Ordered list of models to try if the primary is overloaded (503) or
 * deprecated (404). Users can override the primary via GEMINI_MODEL in .env.
 * The 2.5-flash family is frequently overloaded during peak hours, so we
 * always fall through to 2.0-flash (stable, widely available) and the lite
 * variants as a last resort.
 *
 * IMPORTANT: the old 1.5-flash line was deprecated in late 2025 — do not add
 * it back to this list. Verify availability with `GET /v1beta/models` on the
 * user's key if a model is behaving oddly.
 */
const GEMINI_MODEL_FALLBACKS: string[] = Array.from(
  new Set(
    [
      GEMINI_MODEL,
      process.env.GEMINI_MODEL_FALLBACK?.trim(),
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ].filter((m): m is string => typeof m === 'string' && m.length > 0),
  ),
);
/** Model used for AI image generation in the Deep Brief slide deck. */
const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

const VIDEO_VOICE_PRESETS: Record<string, string> = {
  // Override any of these IDs via env if you have premium cloned voices:
  // ELEVENLABS_VOICE_OBAMA, ELEVENLABS_VOICE_REAGAN, etc.
  obama: process.env.ELEVENLABS_VOICE_OBAMA?.trim() || 'TxGEqnHWrfWFTfGW9XjX',
  reagan: process.env.ELEVENLABS_VOICE_REAGAN?.trim() || 'ErXwobaYiN019PkySvjV',
  lincoln: process.env.ELEVENLABS_VOICE_LINCOLN?.trim() || 'pNInz6obpgDQGcFmaJgB',
  // Celebrity / modern-president presets. Default to stable public voices unless
  // a project-specific clone ID is provided via env.
  trump: process.env.ELEVENLABS_VOICE_TRUMP?.trim() || 'TxGEqnHWrfWFTfGW9XjX',
  arnold: process.env.ELEVENLABS_VOICE_ARNOLD?.trim() || 'ErXwobaYiN019PkySvjV',
  stallone: process.env.ELEVENLABS_VOICE_STALLONE?.trim() || 'VR6AewLTigWG4xSOukaG',
  freeman: process.env.ELEVENLABS_VOICE_FREEMAN?.trim() || 'yoZ06aMxZJJ28mfd3POQ',
  oprah: process.env.ELEVENLABS_VOICE_OPRAH?.trim() || '21m00Tcm4TlvDq8ikWAM',
  samuel: process.env.ELEVENLABS_VOICE_SAMUEL?.trim() || 'VR6AewLTigWG4xSOukaG',
};

/** Query `languages=en,fr` or `languages=all`. Omitted: adapters default to English for news. */
function parseNewsLanguagesParam(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === 'all') return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/** `conflictNews=0` disables conflict-focused queries; default on when omitted. */
function parseConflictNewsParam(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return true;
  const t = raw.trim().toLowerCase();
  return !(t === '0' || t === 'false' || t === 'no');
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseIsoDateSafe(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function hasValidSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.source === 'string' &&
    value.source.trim().length > 0 &&
    typeof value.sourceUrl === 'string' &&
    /^https?:\/\//.test(value.sourceUrl)
  );
}

function hasLatLng(value: AnyRecord): boolean {
  return isFiniteNumber(value.lat) && isFiniteNumber(value.lng);
}

function inBbox(lat: number, lng: number, bbox?: [number, number, number, number]): boolean {
  if (!bbox) return true;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lng >= minLon && lng <= maxLon && lat >= minLat && lat <= maxLat;
}

async function readJsonArray(filename: string): Promise<unknown[]> {
  const fullPath = path.join(DATA_DIR, filename);
  const contents = await fs.readFile(fullPath, 'utf8');
  const parsed = JSON.parse(contents);
  return Array.isArray(parsed) ? parsed : [];
}

async function readJsonArraySafe(filename: string): Promise<unknown[]> {
  try {
    return await readJsonArray(filename);
  } catch {
    return [];
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function csvToRecords(csv: string): Record<string, string>[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j] ?? '';
    out.push(row);
  }
  return out;
}

function acledRowToGlobeEntity(row: Record<string, unknown>): GlobeEntity | null {
  const idRaw = row.event_id_cnty ?? row.event_id_no_cnty ?? row.event_id;
  const id = typeof idRaw === 'string' && idRaw.trim() ? idRaw.trim() : null;
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const eventDate =
    typeof row.event_date === 'string' && row.event_date.trim() ? row.event_date.trim() : null;
  const iso = eventDate ? `${eventDate}T23:59:59.999Z` : new Date().toISOString();
  const notes = typeof row.notes === 'string' ? row.notes : '';
  const subEventType =
    typeof row.sub_event_type === 'string'
      ? row.sub_event_type
      : typeof row.event_type === 'string'
        ? row.event_type
        : 'Event';
  return {
    id,
    source: 'acled',
    category: 'conflict',
    subcategory: subEventType,
    label: notes.slice(0, 140) || subEventType,
    lat,
    lon,
    timestamp: iso,
    confidence: 0.6,
    metadata: {
      notes,
      country: typeof row.country === 'string' ? row.country : undefined,
      location: typeof row.location === 'string' ? row.location : undefined,
      event_type: typeof row.event_type === 'string' ? row.event_type : undefined,
      sub_event_type: typeof row.sub_event_type === 'string' ? row.sub_event_type : undefined,
      actor1: typeof row.actor1 === 'string' ? row.actor1 : undefined,
      actor2: typeof row.actor2 === 'string' ? row.actor2 : undefined,
      fatalities: Number.isFinite(Number(row.fatalities)) ? Number(row.fatalities) : 0,
      region: typeof row.region === 'string' ? row.region : undefined,
      sourceUrl: 'https://acleddata.com/conflict-data/download-data-files',
    },
  };
}

async function loadAcledFileFallback(
  fromIso?: string,
  toIso?: string,
): Promise<GlobeEntity[]> {
  const candidates = [
    path.join(DATA_DIR, 'acled-export.json'),
    path.join(DATA_DIR, 'acled-download.json'),
    path.join(DATA_DIR, 'acled-export.csv'),
    path.join(DATA_DIR, 'acled-download.csv'),
  ];
  let rows: Record<string, unknown>[] = [];
  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, 'utf8');
      if (p.endsWith('.json')) {
        const raw = JSON.parse(txt);
        if (Array.isArray(raw)) {
          rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
        } else if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown[] }).data)) {
          rows = (raw as { data: unknown[] }).data.filter(
            (r): r is Record<string, unknown> => !!r && typeof r === 'object',
          );
        }
      } else {
        rows = csvToRecords(txt);
      }
      if (rows.length > 0) break;
    } catch {
      continue;
    }
  }
  if (rows.length === 0) return [];
  const fromT = fromIso ? new Date(fromIso).getTime() : null;
  const toT = toIso ? new Date(toIso).getTime() : null;
  const entities: GlobeEntity[] = [];
  for (const row of rows) {
    const ev = acledRowToGlobeEntity(row);
    if (!ev) continue;
    const t = parseIsoDateSafe(ev.timestamp);
    if (t !== null) {
      if (fromT !== null && Number.isFinite(fromT) && t < fromT) continue;
      if (toT !== null && Number.isFinite(toT) && t > toT) continue;
    }
    entities.push(ev);
  }
  return entities;
}

function isVerifiedEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasValidSource(value) || !hasLatLng(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.background === 'string' &&
    typeof value.country === 'string' &&
    typeof value.region === 'string' &&
    typeof value.type === 'string' &&
    typeof value.category === 'string' &&
    typeof value.severity === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.timestamp === 'string' &&
    isRecord(value.social) &&
    Array.isArray(value.social.platforms)
  );
}

function isVerifiedAircraft(value: unknown): value is Aircraft {
  if (!isRecord(value)) return false;
  if (!hasValidSource(value) || !hasLatLng(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.callsign === 'string' &&
    typeof value.country === 'string' &&
    typeof value.type === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.altitude) &&
    isFiniteNumber(value.speed) &&
    isFiniteNumber(value.heading) &&
    typeof value.observedAt === 'string' &&
    Array.isArray(value.trail)
  );
}

function isVerifiedShip(value: unknown): value is Ship {
  if (!isRecord(value)) return false;
  if (!hasValidSource(value) || !hasLatLng(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.flag === 'string' &&
    typeof value.type === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.speed) &&
    isFiniteNumber(value.heading) &&
    typeof value.observedAt === 'string' &&
    Array.isArray(value.trail)
  );
}

function isVerifiedSatellite(value: unknown): value is Satellite {
  if (!isRecord(value)) return false;
  if (!hasValidSource(value) || !hasLatLng(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.country === 'string' &&
    typeof value.category === 'string' &&
    typeof value.orbit === 'string' &&
    isFiniteNumber(value.altitude) &&
    typeof value.observedAt === 'string' &&
    Array.isArray(value.trail)
  );
}

export function registerRoutes(httpServer: Server, app: Express) {
  void loadGdeltRouteCacheFromDisk();

  async function warmGdeltDefaultCache(): Promise<void> {
    if (!gdeltAdapter.enabled()) return;
    const nowIso = new Date().toISOString();
    const fromIso = new Date(Date.now() - 24 * 3_600_000).toISOString();
    try {
      await fetchAndCacheGdelt({
        from: fromIso,
        to: nowIso,
        limit: GDELT_ROUTE_MAX_LIMIT,
        languages: [],
        conflictNews: false,
      });
      console.info('[gdelt-cache] warmed default 24h cache');
    } catch (e) {
      console.warn('[gdelt-cache] warm failed:', e);
    }
  }

  void warmGdeltDefaultCache();
  setInterval(() => {
    void warmGdeltDefaultCache();
  }, GDELT_CACHE_TTL_MS);

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Verified-only datasets. Any record missing provenance is dropped.
  app.get('/api/events', async (_req: Request, res: Response) => {
    const rows = await readJsonArraySafe('verified-events.json');
    res.json(rows.filter(isVerifiedEvent));
  });

  app.get('/api/trackers/aircraft', async (req: Request, res: Response) => {
    const localRows = (await readJsonArraySafe('verified-aircraft.json')).filter(isVerifiedAircraft);
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 25_000) : 25_000;
    const bboxRaw = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
    const bbox = bboxRaw
      ? (bboxRaw.split(',').map(Number) as [number, number, number, number])
      : undefined;
    try {
      let openskyRows: Aircraft[] = [];
      try {
        openskyRows = await fetchOpenSkyAircraft(bbox);
      } catch (osErr) {
        console.error('OpenSky live feed failed:', osErr);
      }
      let airplanesLiveRows: Aircraft[] = [];
      try {
        airplanesLiveRows = await fetchAirplanesLiveAircraft();
      } catch (aplErr) {
        console.error('airplanes.live military feed failed:', aplErr);
      }
      const inView = bbox ?? ([-180, -65, 180, 75] as [number, number, number, number]);
      let fr24Rows: Aircraft[] = [];
      if (flightradar24Enabled()) {
        try {
          fr24Rows = await fetchFlightradar24Aircraft(inView, Math.min(200, limit));
        } catch (frErr) {
          console.error('Flightradar24 live positions failed (check FR24_API_TOKEN & credits):', frErr);
        }
      }

      const osHex = new Set(
        openskyRows.map((a) => aircraftHexFromId(a.id)).filter((h): h is string => Boolean(h)),
      );
      const fr24Filtered = fr24Rows.filter((a) => {
        const h = aircraftHexFromId(a.id);
        return !h || !osHex.has(h);
      });

      const aplFiltered = airplanesLiveRows.filter((a) => {
        const h = aircraftHexFromId(a.id);
        return !h || !osHex.has(h);
      });

      const merged = [...openskyRows, ...aplFiltered, ...fr24Filtered, ...localRows].filter((a) =>
        inBbox(a.lat, a.lng, bbox),
      );
      const deduped = Array.from(new Map(merged.map((a) => [a.id, a] as const)).values());
      return res.json(deduped.slice(0, limit));
    } catch (err) {
      console.error('OpenSky fetch failed, using local verified-aircraft.json only:', err);
      return res.json(localRows.filter((a) => inBbox(a.lat, a.lng, bbox)).slice(0, limit));
    }
  });

  app.get('/api/trackers/ships', async (req: Request, res: Response) => {
    const localRows = (await readJsonArraySafe('verified-ships.json')).filter(isVerifiedShip);
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 25_000) : 25_000;
    const bboxRaw = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
    const bbox = bboxRaw
      ? (bboxRaw.split(',').map(Number) as [number, number, number, number])
      : undefined;

    try {
      let aisstreamRows: Ship[] = [];
      try {
        aisstreamRows = await fetchAisstreamShips({ bbox });
      } catch (aisstreamErr) {
        console.error('AISStream live feed failed:', aisstreamErr);
      }
      let aishubRows: Ship[] = [];
      try {
        aishubRows = await fetchAishubShips({ bbox });
      } catch (aishubErr) {
        console.error('AISHub live feed failed:', aishubErr);
      }
      let marineTrafficRows: Ship[] = [];
      try {
        marineTrafficRows = await fetchMarineTrafficShips({ bbox });
      } catch (mtErr) {
        console.error('MarineTraffic live feed failed:', mtErr);
      }

      const merged = [...marineTrafficRows, ...aisstreamRows, ...aishubRows, ...localRows].filter((s) => inBbox(s.lat, s.lng, bbox));
      const deduped = Array.from(
        new Map(merged.map((s) => [s.mmsi || s.imo || s.id, s] as const)).values(),
      );
      return res.json(deduped.slice(0, limit));
    } catch (err) {
      console.error('Ship fetch failed, using local verified-ships.json only:', err);
      return res.json(localRows.filter((s) => inBbox(s.lat, s.lng, bbox)).slice(0, limit));
    }
  });

  app.get('/api/trackers/satellites', async (req: Request, res: Response) => {
    const localRows = (await readJsonArraySafe('verified-satellites.json')).filter(isVerifiedSatellite);
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 1000;
    try {
      const liveRows = await fetchLiveSatellites(limit);
      const merged = [...liveRows, ...localRows];
      const deduped = Array.from(new Map(merged.map((s) => [s.id, s] as const)).values());
      return res.json(deduped.slice(0, limit));
    } catch (err) {
      console.error('Live satellite TLE propagation failed, using local verified-satellites.json only:', err);
      return res.json(localRows.slice(0, limit));
    }
  });

  app.post('/api/trackers/satellites/intel', async (req: Request, res: Response) => {
    const { satellite, question } = req.body as {
      satellite?: Satellite;
      question?: string;
    };

    if (!satellite || typeof satellite.id !== 'string' || typeof satellite.name !== 'string') {
      return res.status(400).json({ error: 'satellite payload required' });
    }

    const norad = extractNoradId(satellite.id);
    const cleanQuestion = typeof question === 'string' ? question.trim().slice(0, 500) : '';
    const cacheKey = `${norad || satellite.id}:${cleanQuestion || 'summary'}`;
    const cached = satelliteIntelCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAtMs < SATELLITE_INTEL_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Satellite AI intel disabled',
        reason: 'Set GEMINI_API_KEY in .env to enable researched satellite summaries.',
      });
    }

    const prompt = [
      'Research this satellite using Google Search and open-source references.',
      `Satellite name from live TLE: ${satellite.name}`,
      `App tracker ID: ${satellite.id}`,
      norad ? `NORAD catalog number: ${norad}` : '',
      `Current app category: ${satellite.category}`,
      `Current app country guess: ${satellite.country}`,
      `Current app orbit class: ${satellite.orbit}, altitude now: ${satellite.altitude.toFixed(0)} km`,
      cleanQuestion
        ? `User question: ${cleanQuestion}`
        : 'Task: build a concise satellite dossier for the app detail panel.',
      '',
      'Return ONLY JSON with this shape:',
      '{',
      '  "summary": "4-6 sentence plain-English OSINT summary. Include what it is, who operates it, why it exists, launch context, and notable mission context.",',
      '  "country": "best open-source country/operator country, or Unknown",',
      '  "operator": "operator/agency/company if known, or Unknown",',
      '  "launchDate": "launch date if known, or Unknown",',
      '  "launchVehicle": "rocket/launch vehicle if known, or Unknown",',
      '  "launchSite": "launch site/cosmodrome/spaceport if known, or Unknown",',
      '  "yearsInOrbit": "human-readable duration, or Unknown",',
      '  "purpose": "mission/use in one sentence",',
      '  "orbit": "orbit description in one sentence",',
      '  "confidence": "high | medium | low",',
      '  "sources": [{ "title": "source title", "url": "https://..." }]',
      '}',
      'Rules: Search by NORAD catalog number first, then satellite name. Use N2YO satellite database when available for catalog, launch, country, and category context. Prefer official space agency, CelesTrak, N2YO, NASA/NSSDCA, Gunter, ESA, operator pages, or reputable satellite catalogs. Do not invent launch vehicles or launch sites; return Unknown if not found. Do not invent classified details. If sources conflict, say so in the summary and set confidence medium/low.',
    ]
      .filter(Boolean)
      .join('\n');

    const body = JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              'You are an unclassified OSINT space systems analyst. Use Google Search. Return strict JSON only. Be factual, concise, and clear about uncertainty.',
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 2600 },
    });

    let response: globalThis.Response | null = null;
    let lastErrorText = '';
    let lastStatus = 0;
    let modelUsed = GEMINI_MODEL_FALLBACKS[0];

    try {
      for (const model of GEMINI_MODEL_FALLBACKS) {
        const url = `${GEMINI_BASE}/${encodeURIComponent(
          model,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const attempt = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (attempt.ok) {
          response = attempt;
          modelUsed = model;
          break;
        }
        lastStatus = attempt.status;
        lastErrorText = await attempt.text();
        console.warn(
          `[satellite-intel] ${model} returned ${attempt.status}: ${formatGeminiError(lastErrorText)}`,
        );
        if (![404, 429, 500, 502, 503, 504].includes(attempt.status)) break;
      }

      if (!response) {
        return res.status(lastStatus || 502).json({
          error: 'Gemini API error',
          reason: formatGeminiError(lastErrorText),
        });
      }

      const data = (await response.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          groundingMetadata?: {
            groundingChunks?: { web?: { uri?: string; title?: string } }[];
          };
        }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p) => p?.text ?? '').join('').trim();
      const parsed = content ? (tryParseBriefingJson(content) as Partial<SatelliteIntelPayload> | null) : null;
      const payload: SatelliteIntelPayload = parsed?.summary
        ? {
            summary: String(parsed.summary),
            country: typeof parsed.country === 'string' ? parsed.country : satellite.country,
            operator: typeof parsed.operator === 'string' ? parsed.operator : undefined,
            launchDate: typeof parsed.launchDate === 'string' ? parsed.launchDate : undefined,
            launchVehicle: typeof parsed.launchVehicle === 'string' ? parsed.launchVehicle : undefined,
            launchSite: typeof parsed.launchSite === 'string' ? parsed.launchSite : undefined,
            yearsInOrbit: typeof parsed.yearsInOrbit === 'string' ? parsed.yearsInOrbit : undefined,
            purpose: typeof parsed.purpose === 'string' ? parsed.purpose : undefined,
            orbit: typeof parsed.orbit === 'string' ? parsed.orbit : undefined,
            confidence: typeof parsed.confidence === 'string' ? parsed.confidence : undefined,
            sources: sanitizeSatelliteSources(parsed.sources, candidate?.groundingMetadata?.groundingChunks),
            generatedAt: new Date().toISOString(),
            model: modelUsed,
          }
        : fallbackSatelliteIntel(satellite, modelUsed);

      if (payload.sources.length === 0 && satellite.sourceUrl) {
        payload.sources = [{ title: satellite.source, url: satellite.sourceUrl }];
      }
      satelliteIntelCache.set(cacheKey, { payload, updatedAtMs: Date.now() });
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({
        error: 'Satellite intel lookup failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.post('/api/trackers/intel', async (req: Request, res: Response) => {
    const { kind, tracker, question } = req.body as {
      kind?: 'aircraft' | 'ships';
      tracker?: Aircraft | Ship;
      question?: string;
    };

    if ((kind !== 'aircraft' && kind !== 'ships') || !tracker || typeof tracker.id !== 'string') {
      return res.status(400).json({ error: 'aircraft or ship tracker payload required' });
    }

    const cleanQuestion = typeof question === 'string' ? question.trim().slice(0, 500) : '';
    const cacheKey = `${kind}:${tracker.id}:${cleanQuestion || 'summary'}`;
    const cached = trackerIntelCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAtMs < TRACKER_INTEL_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Tracker AI intel disabled',
        reason: 'Set GEMINI_API_KEY in .env to enable researched aircraft and ship summaries.',
      });
    }

    const target =
      kind === 'aircraft'
        ? (() => {
            const aircraft = tracker as Aircraft;
            return [
              'Research this aircraft using Google Search and open-source references.',
              `Callsign / flight identifier: ${aircraft.callsign}`,
              `FlightAware candidate URL: https://www.flightaware.com/live/flight/${encodeURIComponent(aircraft.callsign.replace(/\s+/g, ''))}`,
              `Tracker ID: ${aircraft.id}`,
              `Reported type/model from feed: ${aircraft.type}`,
              `Reported country from feed: ${aircraft.country}`,
              `Reported operator/carrier from feed: ${aircraft.carrier ?? 'Unknown'}`,
              `Reported category: ${aircraft.category}`,
              'Search by callsign, ICAO hex/registration if inferable from the tracker ID, aircraft type, operator, and country.',
              'If this appears to be a civilian airline flight, prioritize FlightAware/FlightRadar-style pages to identify airline, origin, destination, scheduled/actual times, and whether it is on time, delayed, early, landed, or cancelled.',
              'Prefer FAA/registry data, ADS-B Exchange-style context, airline/operator pages, FlightAware/FlightRadar context, military fact sheets, manufacturer pages, and reputable aviation references.',
            ];
          })()
        : (() => {
            const ship = tracker as Ship;
            return [
              'Research this ship using Google Search and open-source references.',
              `Vessel name: ${ship.name}`,
              `Tracker ID: ${ship.id}`,
              `Reported vessel type from feed: ${ship.type}`,
              `Reported flag from feed: ${ship.flag}`,
              `Reported category: ${ship.category}`,
              `Reported destination from feed: ${ship.destination ?? 'Unknown'}`,
              'Search by vessel name, MMSI/IMO/callsign if inferable from the tracker ID, flag, type, and destination.',
              'Prefer MarineTraffic/VesselFinder-style public context, Equasis, BalticShipping, owner/operator pages, naval references, shipspotting registries, and reputable maritime references.',
            ];
          })();

    const prompt = [
      ...target,
      cleanQuestion
        ? `User question: ${cleanQuestion}`
        : `Task: build a concise ${kind === 'aircraft' ? 'aircraft' : 'ship'} dossier for the app detail panel.`,
      '',
      'Return ONLY JSON with this shape:',
      '{',
      '  "summary": "4-6 sentence plain-English OSINT summary. Include what it is, who operates/owns it if known, what it is used for, and relevant open-source context.",',
      '  "airline": "civilian airline name if this is an airline flight, otherwise Unknown",',
      '  "operator": "operator/agency/company/unit if known, or Unknown",',
      '  "country": "country/flag state if known, or Unknown",',
      '  "registration": "aircraft registration / ICAO hex / MMSI / IMO / callsign if known, or Unknown",',
      '  "modelOrClass": "aircraft model or ship class/type if known, or Unknown",',
      '  "origin": "departure airport/city if known, or Unknown",',
      '  "destination": "arrival airport/city if known, or Unknown",',
      '  "scheduledDeparture": "scheduled/actual departure time if known, or Unknown",',
      '  "scheduledArrival": "scheduled/estimated/actual arrival time if known, or Unknown",',
      '  "flightStatus": "on time | delayed | early | en route | landed | cancelled | unknown, with brief context if known",',
      '  "role": "mission/use/role in one sentence",',
      '  "owner": "owner if known, or Unknown",',
      '  "flag": "ship flag state if relevant, otherwise Unknown",',
      '  "built": "manufacture/build/commissioning year if known, or Unknown",',
      '  "confidence": "high | medium | low",',
      '  "sources": [{ "title": "source title", "url": "https://..." }]',
      '}',
      'Rules: Do not invent airline, route, schedule, registration, owner, operator, military unit, MMSI, IMO, or classified/sensitive details. Return Unknown when not found. If route/status comes from a flight tracking page, include that page in sources. If sources conflict, state that in summary and set confidence medium/low.',
    ].join('\n');

    const body = JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              'You are an unclassified OSINT air and maritime systems analyst. Use Google Search. Return strict JSON only. Be factual, concise, and clear about uncertainty.',
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 2600 },
    });

    let response: globalThis.Response | null = null;
    let lastErrorText = '';
    let lastStatus = 0;
    let modelUsed = GEMINI_MODEL_FALLBACKS[0];

    try {
      for (const model of GEMINI_MODEL_FALLBACKS) {
        const url = `${GEMINI_BASE}/${encodeURIComponent(
          model,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const attempt = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (attempt.ok) {
          response = attempt;
          modelUsed = model;
          break;
        }
        lastStatus = attempt.status;
        lastErrorText = await attempt.text();
        console.warn(
          `[tracker-intel] ${model} returned ${attempt.status}: ${formatGeminiError(lastErrorText)}`,
        );
        if (![404, 429, 500, 502, 503, 504].includes(attempt.status)) break;
      }

      if (!response) {
        return res.status(lastStatus || 502).json({
          error: 'Gemini API error',
          reason: formatGeminiError(lastErrorText),
        });
      }

      const data = (await response.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          groundingMetadata?: {
            groundingChunks?: { web?: { uri?: string; title?: string } }[];
          };
        }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p) => p?.text ?? '').join('').trim();
      const parsed = content ? (tryParseBriefingJson(content) as Partial<TrackerIntelPayload> | null) : null;
      const payload: TrackerIntelPayload = parsed?.summary
        ? {
            summary: String(parsed.summary),
            airline: typeof parsed.airline === 'string' ? parsed.airline : undefined,
            operator: typeof parsed.operator === 'string' ? parsed.operator : undefined,
            country: typeof parsed.country === 'string' ? parsed.country : undefined,
            registration: typeof parsed.registration === 'string' ? parsed.registration : undefined,
            modelOrClass: typeof parsed.modelOrClass === 'string' ? parsed.modelOrClass : undefined,
            origin: typeof parsed.origin === 'string' ? parsed.origin : undefined,
            destination: typeof parsed.destination === 'string' ? parsed.destination : undefined,
            scheduledDeparture: typeof parsed.scheduledDeparture === 'string' ? parsed.scheduledDeparture : undefined,
            scheduledArrival: typeof parsed.scheduledArrival === 'string' ? parsed.scheduledArrival : undefined,
            flightStatus: typeof parsed.flightStatus === 'string' ? parsed.flightStatus : undefined,
            role: typeof parsed.role === 'string' ? parsed.role : undefined,
            owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
            flag: typeof parsed.flag === 'string' ? parsed.flag : undefined,
            built: typeof parsed.built === 'string' ? parsed.built : undefined,
            confidence: typeof parsed.confidence === 'string' ? parsed.confidence : undefined,
            sources: sanitizeSatelliteSources(parsed.sources, candidate?.groundingMetadata?.groundingChunks),
            generatedAt: new Date().toISOString(),
            model: modelUsed,
          }
        : fallbackTrackerIntel(kind, tracker, modelUsed);

      if (payload.sources.length === 0 && tracker.sourceUrl) {
        payload.sources = [{ title: tracker.source, url: tracker.sourceUrl }];
      }
      trackerIntelCache.set(cacheKey, { payload, updatedAtMs: Date.now() });
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({
        error: 'Tracker intel lookup failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/liveuamap/events', async (req: Request, res: Response) => {
    if (!liveuamapAdapter.enabled()) {
      return res.status(503).json({
        error: 'Liveuamap adapter disabled',
        reason:
          'Set LIVEUAMAP_API_KEY and LIVEUAMAP_BASE_URL (official API endpoint from your Liveuamap developer docs).',
        requiredEnv: ['LIVEUAMAP_API_KEY', 'LIVEUAMAP_BASE_URL'],
      });
    }

    const bboxRaw = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
    const bbox = bboxRaw
      ? (bboxRaw.split(',').map(Number) as [number, number, number, number])
      : undefined;

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : undefined;

      const rows = await liveuamapAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
        bbox,
        limit,
      });

      const geojson = {
        type: 'FeatureCollection',
        features: rows.map((row: GlobeEntity) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
          properties: row,
        })),
      };

      return res.json({
        source: 'liveuamap',
        count: rows.length,
        entities: rows,
        geojson,
      });
    } catch (err) {
      console.error('Liveuamap upstream failed:', err);
      return res.status(502).json({
        error: 'Liveuamap upstream error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/perigon/events', async (req: Request, res: Response) => {
    if (!perigonAdapter.enabled()) {
      return res.status(503).json({
        error: 'Perigon adapter disabled',
        reason: 'PERIGON_API_KEY is not set in the server environment.',
        requiredEnv: ['PERIGON_API_KEY'],
      });
    }

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : undefined;

      const rows = await perigonAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
        limit,
        languages: parseNewsLanguagesParam(req.query.languages),
        conflictNews: parseConflictNewsParam(req.query.conflictNews),
      });

      const geojson = {
        type: 'FeatureCollection',
        features: rows.map((row: GlobeEntity) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
          properties: row,
        })),
      };

      return res.json({
        source: 'perigon',
        count: rows.length,
        entities: rows,
        geojson,
      });
    } catch (err) {
      console.error('Perigon /v1/articles/all failed:', err);
      return res.status(502).json({
        error: 'Perigon upstream error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/thenewsapi/events', async (req: Request, res: Response) => {
    if (!thenewsapiAdapter.enabled()) {
      return res.status(503).json({
        error: 'TheNewsAPI adapter disabled',
        reason: 'Set THENEWSAPI_API_TOKEN in .env and restart the server.',
        requiredEnv: ['THENEWSAPI_API_TOKEN'],
      });
    }

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : undefined;

      const rows = await thenewsapiAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
        limit,
        languages: parseNewsLanguagesParam(req.query.languages),
        conflictNews: parseConflictNewsParam(req.query.conflictNews),
      });

      const geojson = {
        type: 'FeatureCollection',
        features: rows.map((row: GlobeEntity) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
          properties: row,
        })),
      };

      return res.json({
        source: 'thenewsapi',
        count: rows.length,
        entities: rows,
        geojson,
      });
    } catch (err) {
      console.error('TheNewsAPI request failed:', err);
      return res.status(502).json({
        error: 'TheNewsAPI upstream error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/gdelt/events', async (req: Request, res: Response) => {
    if (!gdeltAdapter.enabled()) {
      return res.status(503).json({
        error: 'GDELT adapter disabled',
        reason: 'Set GDELT_ENABLED=true (default) or remove GDELT_ENABLED=false from the environment.',
      });
    }

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, GDELT_ROUTE_MAX_LIMIT) : undefined;
      const query: GdeltRouteQuery = {
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        limit,
        languages: parseNewsLanguagesParam(req.query.languages),
        conflictNews: parseConflictNewsParam(req.query.conflictNews),
      };
      const key = gdeltCacheKey(query);
      const cached = gdeltRouteCache.get(key);
      const now = Date.now();
      const fresh = cached && now - cached.updatedAtMs <= GDELT_CACHE_TTL_MS;

      let rows: GlobeEntity[];
      if (fresh && cached.rows.length > 0) {
        rows = cached.rows;
      } else {
        try {
          rows = await fetchAndCacheGdelt(query);
          if (rows.length === 0 && cached && cached.rows.length > 0) {
            console.warn('[gdelt-cache] upstream returned 0; serving previous non-empty cache');
            rows = cached.rows;
          } else if (rows.length === 0) {
            const fallback = Array.from(gdeltRouteCache.values())
              .filter((v) => Array.isArray(v.rows) && v.rows.length > 0)
              .sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];
            if (fallback && now - fallback.updatedAtMs <= GDELT_STALE_FALLBACK_MS) {
              console.warn('[gdelt-cache] upstream returned 0; serving freshest non-empty cache entry');
              rows = fallback.rows;
            }
          }
        } catch (err) {
          if (cached && now - cached.updatedAtMs <= GDELT_STALE_FALLBACK_MS) {
            console.warn('[gdelt-cache] serving stale cache due to upstream error:', err);
            rows = cached.rows;
          } else {
            throw err;
          }
        }
      }

      const geojson = {
        type: 'FeatureCollection',
        features: rows.map((row: GlobeEntity) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
          properties: row,
        })),
      };

      return res.json({
        source: 'gdelt',
        count: rows.length,
        entities: rows,
        geojson,
      });
    } catch (err) {
      console.error('GDELT /api/v2/doc/doc failed:', err);
      return res.status(502).json({
        error: 'GDELT upstream error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/ai/events', async (req: Request, res: Response) => {
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI events disabled',
        reason: 'Set GEMINI_API_KEY in .env to enable AI web-event feed.',
      });
    }
    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 30) : 12;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString();
      const langs = parseNewsLanguagesParam(req.query.languages);

      const prompt = [
        'Return ONLY JSON. Build a list of real, current global hard-news events from web research.',
        `Time window: ${from ?? 'last 24 hours'} to ${to ?? 'now'}.`,
        langs && langs.length > 0
          ? `Prefer sources in languages: ${langs.join(', ')} (include English if available).`
          : 'Include multilingual sources where relevant.',
        `Return exactly ${limit} events with this JSON shape:`,
        '{ "events": [ {',
        '  "title": "headline",',
        '  "summary": "1-2 sentence factual summary",',
        '  "url": "https://source",',
        '  "source": "publisher name",',
        '  "country": "country",',
        '  "region": "region name",',
        '  "timestamp": "ISO-8601",',
        '  "lat": 0,',
        '  "lon": 0,',
        '  "confidence": 0.0',
        '} ] }',
        'Rules: no fabricated events; no duplicate URLs; title and URL required.',
      ].join('\n');

      const body = JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                'You are an OSINT news curator. Use Google Search. Return strict JSON only.',
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 3200 },
      });

      let response: globalThis.Response | null = null;
      let lastErrorText = '';
      let lastStatus = 0;
      for (const model of GEMINI_MODEL_FALLBACKS) {
        const url = `${GEMINI_BASE}/${encodeURIComponent(
          model,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const attempt = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (attempt.ok) {
          response = attempt;
          break;
        }
        lastStatus = attempt.status;
        lastErrorText = await attempt.text();
        if (![404, 429, 500, 502, 503, 504].includes(attempt.status)) break;
      }
      if (!response) {
        return res.status(lastStatus || 502).json({
          error: 'Gemini API error',
          reason: formatGeminiError(lastErrorText),
        });
      }

      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const content = data.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('').trim();
      if (!content) return res.json({ source: 'ai', count: 0, entities: [] as GlobeEntity[] });
      const parsed = tryParseBriefingJson(content) as
        | {
            events?: Array<{
              title?: string;
              summary?: string;
              url?: string;
              source?: string;
              country?: string;
              region?: string;
              timestamp?: string;
              lat?: number;
              lon?: number;
              confidence?: number;
            }>;
          }
        | null;
      const events = parsed?.events ?? [];
      const entities: GlobeEntity[] = events
        .filter((e) => typeof e.title === 'string' && typeof e.url === 'string')
        .slice(0, limit)
        .map((e, idx) => {
          const coords =
            Number.isFinite(e.lat) && Number.isFinite(e.lon)
              ? { lat: Number(e.lat), lon: Number(e.lon) }
              : fallbackCoordsForCountry(e.country);
          return {
            id: `ai-${Date.now()}-${idx}`,
            source: 'ai',
            category: 'news',
            subcategory: 'ai-osint',
            label: e.title || 'AI OSINT event',
            lat: coords.lat,
            lon: coords.lon,
            timestamp:
              typeof e.timestamp === 'string' && e.timestamp.trim()
                ? e.timestamp
                : new Date().toISOString(),
            confidence:
              typeof e.confidence === 'number'
                ? Math.max(0.2, Math.min(0.98, e.confidence))
                : 0.62,
            metadata: {
              sourceUrl: e.url,
              originalTitle: e.title,
              originalText: e.summary,
              sourceName: e.source,
              country: e.country,
              region: e.region,
            },
          };
        });

      return res.json({ source: 'ai', count: entities.length, entities });
    } catch (err) {
      return res.status(500).json({
        error: 'AI events feed failed',
        message: (err as Error).message || 'Unknown AI feed error',
      });
    }
  });

  app.get('/api/acled/events', async (req: Request, res: Response) => {
    if (!acledAdapter.enabled()) {
      return res.status(503).json({
        error: 'ACLED adapter disabled',
        reason:
          'Set ACLED_EMAIL_ADDRESS (or ACLED_EMAIL) and ACLED_ACCESS_KEY from https://developer.acleddata.com/, or legacy ACLED_EMAIL + ACLED_PASSWORD for myACLED OAuth.',
        requiredEnv: [
          'ACLED_ACCESS_KEY',
          'ACLED_EMAIL_ADDRESS',
          'ACLED_EMAIL',
          'ACLED_PASSWORD',
        ],
      });
    }

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const pageSize = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 1000;
      const cursorRaw = typeof req.query.cursor === 'string' ? parseInt(req.query.cursor, 10) : NaN;
      const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.floor(cursorRaw) : 0;
      const fetchLimit = Math.min(ACLED_ROUTE_MAX_LIMIT, cursor + pageSize);

      const fromQ = typeof req.query.from === 'string' ? req.query.from : undefined;
      const toQ = typeof req.query.to === 'string' ? req.query.to : undefined;

      let rowsAll = await acledAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: fromQ,
        to: toQ,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
        limit: fetchLimit,
      });

      if (rowsAll.length === 0) {
        const fileRows = await loadAcledFileFallback(fromQ, toQ);
        if (fileRows.length > 0) {
          rowsAll = fileRows;
        }
      }

      // Adapter widens queries (~14d) so the API returns data; narrow back to the client's window
      // so GDELT + ACLED match the same Filters → Time range and both show in the feed/globe.
      if (fromQ && toQ) {
        const fromDay = fromQ.slice(0, 10);
        const toDay = toQ.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fromDay) && /^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
          rowsAll = rowsAll.filter((row) => {
            const day = typeof row.timestamp === 'string' ? row.timestamp.slice(0, 10) : '';
            return day >= fromDay && day <= toDay;
          });
        }
      }

      const rows = rowsAll.slice(cursor, cursor + pageSize);
      const nextCursor = rows.length === pageSize ? String(cursor + rows.length) : null;

      const geojson = {
        type: 'FeatureCollection',
        features: rows.map((row: GlobeEntity) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
          properties: row,
        })),
      };

      return res.json({
        source: 'acled',
        count: rows.length,
        totalAvailable: rowsAll.length,
        cursor: String(cursor),
        nextCursor,
        entities: rows,
        geojson,
      });
    } catch (err) {
      console.error('ACLED /api/acled/read failed:', err);
      return res.status(502).json({
        error: 'ACLED upstream error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.get('/api/acled/debug', async (_req: Request, res: Response) => {
    try {
      const info = await getAcledDebugInfo();
      return res.json(info);
    } catch (err) {
      return res.status(500).json({
        enabled: acledAdapter.enabled(),
        mode: 'none',
        embargoDate: null,
        message: err instanceof Error ? err.message : 'Unknown ACLED debug error',
      });
    }
  });

  // AI chat — Gemini streaming (SSE)
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { messages, eventContext, mode } = req.body as {
      messages: { role: string; content: string }[];
      eventContext?: string;
      /** "summary" = short 4-paragraph briefing. "chat" = full comprehensive Q&A. */
      mode?: 'summary' | 'chat';
    };

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      return res.status(500).json({
        error: 'Gemini API key not configured',
        hint: 'Add GEMINI_API_KEY (Google AI Studio key, starts with AIza…) to your .env and restart the server.',
      });
    }

    const isChat = mode === 'chat';
    const persona = [
      'You are a senior geospatial intelligence analyst embedded with a joint operations cell.',
      'You combine military, political, economic, and humanitarian perspectives.',
      'You write in clear intelligence-community prose: short paragraphs, concrete detail, no filler.',
    ].join(' ');

    const summaryGuidance = [
      'Produce a concise briefing. Do not ramble. Do not answer follow-up questions.',
    ].join(' ');

    const chatGuidance = [
      '\n\nWhen the user asks a question, give a COMPREHENSIVE, well-structured answer grounded in the event details provided below. Follow these rules:',
      '1. Anchor every claim in the event context. Quote specific fields (title, location, source, related articles, coordinates, reported time) when they support the point.',
      '2. Explain the "so what": tactical significance, operational implications, second-order effects, and how this fits the broader conflict or regional pattern.',
      '3. When the event context does not contain an answer, say so explicitly ("the provided sources do not address X") before offering general, open-source background with low confidence.',
      '4. Never invent casualty counts, unit designations, dates, or quotes. Distinguish clearly between fact (from the event data) and analytic inference.',
      '5. Use short paragraphs. Use bullet lists for comparisons, timelines, or indicator lists. Use markdown headers (## / ###) for sections when the answer is long.',
      '6. End longer answers with a brief "Indicators to watch" list (3-5 items) when relevant.',
      '7. Preserve prior chat history: build on previous answers instead of repeating them verbatim.',
    ].join(' ');

    const systemPrompt = [
      persona,
      isChat ? chatGuidance : summaryGuidance,
      eventContext ? `\n\n=== EVENT CONTEXT ===\n${eventContext}\n=== END EVENT CONTEXT ===` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Gemini uses role "user"/"model" with parts, not OpenAI's "system"/"user"/"assistant".
    // We surface the system prompt via `systemInstruction`.
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chatBody = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        // Lower temperature for chat so answers stick closer to the event facts.
        temperature: isChat ? 0.45 : 0.6,
        // Chat answers should be allowed to go long enough for a full analytic response.
        maxOutputTokens: isChat ? 2048 : 1024,
      },
    });

    try {
      // Try each model in order, falling through on overload/not-found.
      let response: globalThis.Response | null = null;
      let lastErrorText = '';
      let lastStatus = 0;
      let modelUsed = GEMINI_MODEL_FALLBACKS[0];
      for (const model of GEMINI_MODEL_FALLBACKS) {
        const url = `${GEMINI_BASE}/${encodeURIComponent(
          model,
        )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const attempt = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: chatBody,
        });
        if (attempt.ok) {
          response = attempt;
          modelUsed = model;
          break;
        }
        lastStatus = attempt.status;
        lastErrorText = await attempt.text();
        console.warn(
          `[chat] ${model} returned ${attempt.status}: ${formatGeminiError(lastErrorText)}`,
        );
        if (![404, 429, 500, 502, 503, 504].includes(attempt.status)) break;
      }

      if (!response) {
        const reason = formatGeminiError(lastErrorText);
        const hint =
          lastStatus === 400 || lastStatus === 401 || lastStatus === 403
            ? 'Your Gemini key is invalid. Generate a new key at https://aistudio.google.com/apikey and update .env.'
            : lastStatus === 429 || lastStatus === 503
              ? 'Gemini is rate-limited or overloaded across every model we tried. Wait a few seconds and retry.'
              : lastStatus === 404
                ? 'No configured Gemini model is available on this key.'
                : undefined;
        return res
          .status(lastStatus || 502)
          .json({ error: 'Gemini API error', reason, hint, detail: lastErrorText });
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Gemini-Model', modelUsed);

      const reader = response.body?.getReader();
      if (!reader) return res.end();

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const parts = parsed?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                if (typeof p?.text === 'string' && p.text.length > 0) {
                  res.write(p.text);
                }
              }
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      res.end();
    } catch (err) {
      console.error('Chat route error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      } else {
        res.end();
      }
    }
  });

  // Briefing generation — returns structured analysis per topic
  app.post('/api/briefing/generate', async (req: Request, res: Response) => {
    const { topic, briefingSection, useSearch } = req.body as {
      topic: string;
      /** Optional explicit section label (e.g. Slide 2: EUCOM). */
      briefingSection?: string;
      /** When true, enable Gemini's Google Search tool for direct web OSINT
       *  research. Defaults to true. */
      useSearch?: boolean;
    };

    if (!topic) return res.status(400).json({ error: 'topic required' });

    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      return res.status(500).json({
        error: 'Gemini API key not configured',
        hint: 'Add GEMINI_API_KEY (Google AI Studio key, starts with AIza…) to your .env and restart the server.',
      });
    }

    const grounded = useSearch !== false;

    const userPrompt = [
      briefingSection ? `Section: "${briefingSection}"` : '',
      `Topic: "${topic}"`,
      'Research window: prioritize the last 24 hours. You must gather evidence from web search, not from any local app feed context.',
      grounded
        ? 'Use Google Search to gather OSINT context (official statements, reputable reporting, military and legislative updates). Prefer primary sources and cite findings.'
        : '',
      'Role: Senior Intelligence Briefing Officer (SIBO) preparing an Unclassified Presidential Daily Briefing section.',
      'Style: BLUF first, objective analytical language, no partisan framing. Keep the visual tone executive but keep all output UNCLASSIFIED.',
      'Return ONLY a JSON object (no markdown, no prose before or after) with this shape:',
      '{',
      '  "summary": "4-7 sentence executive assessment with concrete context",',
      '  "keyPoints": ["6-8 concise indicator-style bullets, each <=220 chars"],',
      '  "threatLevel": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",',
      '  "regions": ["list of 2-5 specific affected countries/regions"],',
      '  "indicators": ["4-6 early-warning indicators to watch over the next 48h"],',
      '  "strategicImplication": "3-4 sentences: how this affects U.S. National Interests specifically"',
      '}',
      'Anchor every claim in the web sources you cite. Do not invent casualty figures, unit designations, dates, legislative status, or quotes.',
    ]
      .filter(Boolean)
      .join('\n');

    /**
     * When Google Search is enabled we cannot set responseMimeType=application/json
     * because the tool-call pipeline overrides structured output. We strip the
     * MIME type and parse the model's JSON defensively with tryParseBriefingJson.
     */
    const tools = grounded ? [{ googleSearch: {} }] : undefined;
    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              'You are a senior intelligence briefing officer producing an Unclassified Presidential Daily Brief section. Return strict JSON only, BLUF-first, grounded in Google Search evidence. Every section must contain a concrete strategic implication for U.S. national interests.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      ...(tools ? { tools } : {}),
      generationConfig: {
        temperature: 0.4,
        // Tool calls + search results burn tokens before text generation even
        // starts. Grounded responses routinely truncate at 1400-1800 tokens,
        // so give the model plenty of headroom. Non-grounded JSON is terse.
        maxOutputTokens: grounded ? 3500 : 1400,
        ...(grounded ? {} : { responseMimeType: 'application/json' }),
      },
    });

    // Try each model in order; fall through on 503 (overloaded) / 429
    // (rate-limited) / 404 (deprecated model). For any other error we stop
    // immediately and surface it to the client.
    let response: globalThis.Response | null = null;
    let lastErrorText = '';
    let lastStatus = 0;
    let modelUsed = GEMINI_MODEL_FALLBACKS[0];

    try {
      for (const model of GEMINI_MODEL_FALLBACKS) {
        const url = `${GEMINI_BASE}/${encodeURIComponent(
          model,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const attempt = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        });
        if (attempt.ok) {
          response = attempt;
          modelUsed = model;
          break;
        }
        lastStatus = attempt.status;
        lastErrorText = await attempt.text();
        console.warn(
          `[briefing] ${model} returned ${attempt.status}: ${formatGeminiError(lastErrorText)}`,
        );
        // Only fall through on transient/overload/not-found. Auth + quota
        // errors (400/401/403) affect every model so short-circuit.
        if (![404, 429, 500, 502, 503, 504].includes(attempt.status)) {
          break;
        }
      }

      if (!response) {
        const reason = formatGeminiError(lastErrorText);
        const hint =
          lastStatus === 503 || lastStatus === 429
            ? 'Gemini is overloaded across every model we tried. Wait 30-60s and regenerate.'
            : lastStatus === 400 || lastStatus === 401 || lastStatus === 403
              ? 'Gemini rejected the API key. Regenerate it at https://aistudio.google.com/apikey and update .env.'
              : lastStatus === 404
                ? 'No configured Gemini model is available on this key. Set GEMINI_MODEL in .env to a model you have access to.'
                : undefined;
        return res.status(lastStatus || 502).json({
          error: 'Gemini API error',
          reason,
          hint,
          detail: lastErrorText,
        });
      }
      console.info(`[briefing] generated via ${modelUsed}`);

      const data = (await response.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
          groundingMetadata?: {
            groundingChunks?: {
              web?: { uri?: string; title?: string };
            }[];
            webSearchQueries?: string[];
          };
        }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p) => p?.text ?? '').join('').trim();
      if (!content) {
        return res.status(500).json({
          error: 'No content from Gemini',
          reason:
            candidate?.finishReason === 'MAX_TOKENS'
              ? 'Gemini hit its token ceiling before returning any content.'
              : 'Gemini returned an empty response.',
        });
      }

      /**
       * Google Search grounding returns citations via candidates[0].groundingMetadata.
       * We surface them so the UI can render clickable source chips under each
       * brief section. Deduplicate by URI and cap at 8 to keep the UI readable.
       */
      const citationsRaw =
        candidate?.groundingMetadata?.groundingChunks
          ?.map((c) => c.web)
          .filter((w): w is { uri: string; title?: string } => !!w?.uri) ?? [];
      const seenUris = new Set<string>();
      const citations: { uri: string; title: string }[] = [];
      for (const c of citationsRaw) {
        if (seenUris.has(c.uri)) continue;
        seenUris.add(c.uri);
        citations.push({ uri: c.uri, title: c.title || hostnameFromUrl(c.uri) });
        if (citations.length >= 8) break;
      }
      const searchQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
      const parsed = tryParseBriefingJson(content) as Record<string, unknown> | null;
      const parsedRegions =
        parsed && Array.isArray(parsed.regions)
          ? parsed.regions.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
          : [];
      const mapFocus = mapFocusFromRegions(parsedRegions, topic);
      const visualImages: Array<{ uri: string; title: string; imageUrl: string }> = [];
      const imageCandidates = citations.slice(0, 6);
      const imageHits = await Promise.all(
        imageCandidates.map(async (c) => {
          const imageUrl = await fetchCitationImage(c.uri);
          return imageUrl ? { uri: c.uri, title: c.title, imageUrl } : null;
        }),
      );
      for (const hit of imageHits) {
        if (!hit) continue;
        visualImages.push(hit);
        if (visualImages.length >= 4) break;
      }
      if (parsed && typeof parsed === 'object') {
        return res.json({
          ...parsed,
          citations,
          searchQueries,
          modelUsed,
          visuals: {
            map: mapFocus,
            images: visualImages,
          },
        });
      }

      // Final fallback: return the raw text wrapped as a summary so the UI still
      // has something to display instead of a hard 500.
      console.warn(
        '[briefing] Gemini returned unparseable JSON; returning raw text as summary.',
      );
      res.json({
        summary: content.slice(0, 1400),
        keyPoints: [],
        threatLevel: 'MEDIUM',
        regions: [],
        strategicImplication:
          'Potential second-order effects for U.S. interests require continued monitoring and validation from additional sources.',
        citations,
        searchQueries,
        modelUsed,
        visuals: {
          map: mapFocus,
          images: visualImages,
        },
      });
    } catch (err) {
      console.error('Briefing generate error:', err);
      res.status(500).json({
        error: 'Internal server error',
        reason: (err as Error).message || 'Unknown failure',
      });
    }
  });

  /**
   * Generate narrated speech audio for a single briefing slide.
   * Used by the client-side "Create Video Brief" workflow.
   */
  app.post('/api/briefing/video-tts', async (req: Request, res: Response) => {
    const { text, voicePreset, tone } = req.body as {
      text?: string;
      voicePreset?: string;
      tone?: 'official' | 'neutral' | 'funny';
    };
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }
    const trimmed = text.trim().slice(0, 2500);
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({
        error: 'ElevenLabs API key not configured',
        reason: 'Missing ELEVENLABS_API_KEY in server .env',
        hint: 'Add ELEVENLABS_API_KEY to .env and restart the server.',
      });
    }

    const chosenVoiceId =
      (voicePreset && VIDEO_VOICE_PRESETS[voicePreset]) ||
      VIDEO_VOICE_PRESETS.obama ||
      'TxGEqnHWrfWFTfGW9XjX';

    const voiceSettings =
      tone === 'funny'
        ? { stability: 0.25, similarity_boost: 0.72, style: 0.68, use_speaker_boost: true }
        : tone === 'neutral'
          ? { stability: 0.5, similarity_boost: 0.72, style: 0.35, use_speaker_boost: true }
          : { stability: 0.72, similarity_boost: 0.74, style: 0.2, use_speaker_boost: true };

    try {
      const ttsUrl = `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(
        chosenVoiceId,
      )}?output_format=mp3_44100_128`;
      const ttsRes = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: trimmed,
          model_id: 'eleven_multilingual_v2',
          voice_settings: voiceSettings,
        }),
      });
      if (!ttsRes.ok) {
        const raw = await ttsRes.text();
        return res.status(ttsRes.status).json({
          error: 'ElevenLabs API error',
          reason: raw.slice(0, 320),
          hint: 'Check voice configuration and account quota.',
        });
      }
      const audio = Buffer.from(await ttsRes.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(audio);
    } catch (err) {
      return res.status(500).json({
        error: 'TTS generation failed',
        reason: (err as Error).message || 'Unknown TTS failure',
      });
    }
  });
}
