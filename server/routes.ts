import type { Express, Request, Response } from 'express';
import type { Server } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { liveuamapAdapter } from '../src/adapters/liveuamap';
import { perigonAdapter } from '../src/adapters/perigon';
import { thenewsapiAdapter } from '../src/adapters/thenewsapi';
import { acledAdapter } from '../src/adapters/acled';
import { gdeltAdapter } from '../src/adapters/gdelt';
import { fetchOpenSkyAircraft } from '../src/adapters/opensky';
import { fetchAirplanesLiveAircraft } from '../src/adapters/airplanesLive';
import { fetchAishubShips } from '../src/adapters/aishub';
import {
  aircraftHexFromId,
  fetchFlightradar24Aircraft,
  flightradar24Enabled,
} from '../src/adapters/flightradar24';
import type { GlobeEntity } from '../src/types/globe';
import type { Aircraft, Ship } from '../client/src/data/trackers';

type AnyRecord = Record<string, unknown>;

const DATA_DIR = path.resolve(process.cwd(), 'server/data');

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

function isVerifiedSatellite(value: unknown): boolean {
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
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 300;
    const bboxRaw = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
    const bbox = bboxRaw
      ? (bboxRaw.split(',').map(Number) as [number, number, number, number])
      : undefined;
    try {
      let openskyRows: Aircraft[] = [];
      try {
        openskyRows = await fetchOpenSkyAircraft();
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
          fr24Rows = await fetchFlightradar24Aircraft(inView, Math.min(150, limit));
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
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 500;
    const bboxRaw = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
    const bbox = bboxRaw
      ? (bboxRaw.split(',').map(Number) as [number, number, number, number])
      : undefined;

    try {
      let aishubRows: Ship[] = [];
      try {
        aishubRows = await fetchAishubShips({ bbox });
      } catch (aishubErr) {
        console.error('AISHub live feed failed:', aishubErr);
      }

      const merged = [...aishubRows, ...localRows].filter((s) => inBbox(s.lat, s.lng, bbox));
      const deduped = Array.from(new Map(merged.map((s) => [s.id, s] as const)).values());
      return res.json(deduped.slice(0, limit));
    } catch (err) {
      console.error('Ship fetch failed, using local verified-ships.json only:', err);
      return res.json(localRows.filter((s) => inBbox(s.lat, s.lng, bbox)).slice(0, limit));
    }
  });

  app.get('/api/trackers/satellites', async (_req: Request, res: Response) => {
    const rows = await readJsonArraySafe('verified-satellites.json');
    res.json(rows.filter(isVerifiedSatellite));
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
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 120) : undefined;

      const rows = await gdeltAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
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
        reason: 'Set ACLED_EMAIL and ACLED_PASSWORD in the server environment (myACLED API access required).',
        requiredEnv: ['ACLED_EMAIL', 'ACLED_PASSWORD'],
      });
    }

    try {
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;

      const rows = await acledAdapter.fetch({
        region: typeof req.query.region === 'string' ? req.query.region : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
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
        source: 'acled',
        count: rows.length,
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
