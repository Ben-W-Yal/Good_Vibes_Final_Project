import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
} from 'satellite.js';
import type { Satellite } from '../../client/src/data/trackers';

type TleRecord = {
  name: string;
  line1: string;
  line2: string;
  sourceGroup?: string;
  sourceUrl?: string;
};

const CELESTRAK_ACTIVE_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const CELESTRAK_STATIONS_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle';
const CELESTRAK_TLE_GROUPS = [
  { key: 'stations', url: CELESTRAK_STATIONS_TLE_URL },
  { key: 'visual', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle' },
  { key: 'weather', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle' },
  { key: 'noaa', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=tle' },
  { key: 'gps-ops', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle' },
  { key: 'geo', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=tle' },
  { key: 'military', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=tle' },
  { key: 'radar', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=radar&FORMAT=tle' },
  { key: 'active', url: CELESTRAK_ACTIVE_TLE_URL },
];
const TLE_CACHE_TTL_MS = 30 * 60_000;
const EARTH_RADIUS_KM = 6371;

let tleCache: { rows: TleRecord[]; updatedAtMs: number } | null = null;

function tleId(line1: string, fallback: string): string {
  const norad = line1.slice(2, 7).trim();
  return norad ? `sat-${norad}` : `sat-${fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function noradId(line1: string): string {
  return line1.slice(2, 7).trim();
}

function displayName(tle: TleRecord): string {
  if (noradId(tle.line1) === '25544' || /^ISS \(ZARYA\)$/i.test(tle.name)) {
    return 'International Space Station ISS';
  }
  return tle.name;
}

function includeTle(tle: TleRecord): boolean {
  const name = tle.name.toLowerCase();
  // Keep the main ISS, but avoid cluttering the list with ISS debris/modules.
  if (name.startsWith('iss ') && !/^iss \(zarya\)$/i.test(tle.name)) return false;
  if (/\b(deb|object)\b/i.test(tle.name)) return false;
  return true;
}

function orbitFromAltitude(altKm: number): Satellite['orbit'] {
  if (altKm >= 30_000) return 'GEO';
  if (altKm >= 2_000) return 'MEO';
  if (altKm >= 1_200) return 'HEO';
  return 'LEO';
}

function categoryFromName(tle: TleRecord): Satellite['category'] {
  const name = tle.name;
  const n = name.toLowerCase();
  if (/(iss|zarya|tiangong)/.test(n)) return 'scientific';
  if (/(gps|galileo|glonass|beidou|qzss|navstar)/.test(n)) return 'navigation';
  if (/(noaa|goes|metop|meteor|weather|himawari|fengyun)/.test(n)) return 'weather';
  if (
    tle.sourceGroup === 'military' ||
    /(usa|nrol|nro |cosmos|kosmos|milstar|sbirs|dsp|lacrosse|yaogan|ofeq|sds|aehf|wgs|muos|dmsp|trumpet|mentor|mercury|orion|topaz)/.test(n)
  ) return 'military';
  if (/(iss|tiangong|hubble|landsat|sentinel|aqua|terra|science|swift|fermi)/.test(n)) return 'scientific';
  return 'communications';
}

function affiliationFromTle(tle: TleRecord): NonNullable<Satellite['affiliation']> {
  const n = tle.name.toLowerCase();
  if (
    tle.sourceGroup === 'military' ||
    /(usa|nrol|nro |cosmos|kosmos|milstar|sbirs|dsp|lacrosse|yaogan|ofeq|sds|aehf|wgs|muos|dmsp|trumpet|mentor|mercury|orion|topaz|navstar|gps)/.test(n)
  ) {
    return 'military';
  }
  return 'civilian';
}

function countryFromName(name: string): string {
  const n = name.toLowerCase();
  if (/(iss|zarya)/.test(n)) return 'International';
  if (/(cosmos|kosmos|meteor)/.test(n)) return 'Russia';
  if (/(yaogan|beidou|fengyun|tiangong)/.test(n)) return 'China';
  if (/(galileo|sentinel|metop)/.test(n)) return 'Europe';
  if (/(usa|gps|navstar|goes|noaa|landsat|hubble|nrol|nro |milstar|sbirs|dsp|aehf|wgs|muos|dmsp)/.test(n)) return 'United States';
  return 'Unknown';
}

function parseTle(text: string, sourceGroup: string, sourceUrl: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: TleRecord[] = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
      rows.push({ name, line1, line2, sourceGroup, sourceUrl });
    }
  }
  return rows;
}

async function fetchTleGroup(group: { key: string; url: string }): Promise<TleRecord[]> {
  const res = await fetch(group.url, {
    headers: { 'User-Agent': 'GeoIntel/1.0 (+live satellite tracker)' },
  });
  if (!res.ok) throw new Error(`CelesTrak TLE request failed: ${res.status}`);
  return parseTle(await res.text(), group.key, group.url);
}

async function fetchActiveTles(): Promise<TleRecord[]> {
  const now = Date.now();
  if (tleCache && now - tleCache.updatedAtMs < TLE_CACHE_TTL_MS) return tleCache.rows;

  const groups = await Promise.all(CELESTRAK_TLE_GROUPS.map((group) => fetchTleGroup(group).catch(() => [])));
  const merged = groups.flat();
  const rows = Array.from(new Map(merged.filter(includeTle).map((tle) => [noradId(tle.line1), tle] as const)).values()).sort(
    (a, b) => {
      const aIss = noradId(a.line1) === '25544' ? 0 : 1;
      const bIss = noradId(b.line1) === '25544' ? 0 : 1;
      if (aIss !== bIss) return aIss - bIss;
      return a.name.localeCompare(b.name);
    },
  );
  if (rows.length === 0) throw new Error('CelesTrak returned no parseable TLE rows');
  tleCache = { rows, updatedAtMs: now };
  return rows;
}

function propagateTle(tle: TleRecord, when: Date): Satellite | null {
  try {
    const satrec = twoline2satrec(tle.line1, tle.line2);
    const pv = propagate(satrec, when);
    if (!pv.position || typeof pv.position === 'boolean') return null;

    const gmst = gstime(when);
    const geo = eciToGeodetic(pv.position, gmst);
    const lat = degreesLat(geo.latitude);
    const lng = degreesLong(geo.longitude);
    const altitude = Math.max(0, geo.height);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altitude)) return null;

    return {
      id: tleId(tle.line1, tle.name),
      name: displayName(tle),
      country: countryFromName(tle.name),
      category: categoryFromName(tle),
      affiliation: affiliationFromTle(tle),
      orbit: orbitFromAltitude(altitude),
      lat,
      lng,
      altitude,
      trail: buildTrail(tle, when),
      source: 'CelesTrak TLE / SGP4',
      sourceUrl: tle.sourceUrl ?? CELESTRAK_ACTIVE_TLE_URL,
      observedAt: when.toISOString(),
    };
  } catch {
    return null;
  }
}

function buildTrail(tle: TleRecord, when: Date): { lat: number; lng: number }[] {
  const trail: { lat: number; lng: number }[] = [];
  const satrec = twoline2satrec(tle.line1, tle.line2);
  for (let minutes = -45; minutes <= 45; minutes += 9) {
    try {
      const t = new Date(when.getTime() + minutes * 60_000);
      const pv = propagate(satrec, t);
      if (!pv.position || typeof pv.position === 'boolean') continue;
      const geo = eciToGeodetic(pv.position, gstime(t));
      const lat = degreesLat(geo.latitude);
      const lng = degreesLong(geo.longitude);
      const alt = Math.max(0, geo.height);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || alt < EARTH_RADIUS_KM * -0.5) continue;
      trail.push({ lat, lng });
    } catch {
      // skip malformed sample
    }
  }
  return trail;
}

export async function fetchLiveSatellites(limit = 1000): Promise<Satellite[]> {
  const tles = await fetchActiveTles();
  const now = new Date();
  const rows: Satellite[] = [];

  for (const tle of tles) {
    const sat = propagateTle(tle, now);
    if (!sat) continue;
    rows.push(sat);
    if (rows.length >= limit) break;
  }

  return rows;
}
