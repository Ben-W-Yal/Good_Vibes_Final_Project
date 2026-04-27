import { withCache } from "../lib/cache";
import type { Ship } from "../../client/src/data/trackers";

type Bbox = [number, number, number, number];

const MARINETRAFFIC_DOCS_URL = "https://www.marinetraffic.com/en/ais-api-services";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

function looksMilitary(name: string, type: string): boolean {
  const value = `${name} ${type}`.toLowerCase();
  return /(navy|naval|warship|frigate|destroyer|carrier|patrol|coast guard|military)/.test(value);
}

function vesselGroup(type: string): string | undefined {
  const t = type.toLowerCase();
  if (t.includes("cargo") || t.includes("container") || t.includes("bulk")) return "cargo";
  if (t.includes("tanker") || t.includes("lng") || t.includes("lpg")) return "tanker";
  if (t.includes("passenger") || t.includes("cruise") || t.includes("ferry")) return "passenger";
  if (t.includes("fishing")) return "fishing";
  return undefined;
}

function buildMarineTrafficUrl(base: string, apiKey: string, bbox?: Bbox): string {
  const [minLon, minLat, maxLon, maxLat] = bbox ?? [-180, -85, 180, 85];
  let url = base
    .replaceAll("{key}", encodeURIComponent(apiKey))
    .replaceAll("{apiKey}", encodeURIComponent(apiKey))
    .replaceAll("{minLon}", String(minLon))
    .replaceAll("{minLat}", String(minLat))
    .replaceAll("{maxLon}", String(maxLon))
    .replaceAll("{maxLat}", String(maxLat));

  if (!/^https?:\/\//i.test(url)) return "";

  const parsed = new URL(url);
  const keyParam = process.env.MARINETRAFFIC_API_KEY_PARAM?.trim() || "key";
  if (!url.includes("{key}") && !url.includes("{apiKey}") && !parsed.searchParams.has(keyParam)) {
    parsed.searchParams.set(keyParam, apiKey);
  }
  for (const [key, value] of [
    ["minlon", minLon],
    ["minlat", minLat],
    ["maxlon", maxLon],
    ["maxlat", maxLat],
  ] as const) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, String(value));
  }
  if (!parsed.searchParams.has("format")) parsed.searchParams.set("format", "json");
  return parsed.toString();
}

function normalizeRow(row: Record<string, unknown>, idx: number): Ship | null {
  const lat = num(pick(row, ["LAT", "LATITUDE", "lat", "latitude"]));
  const lng = num(pick(row, ["LON", "LONGITUDE", "lon", "lng", "longitude"]));
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const mmsi = str(pick(row, ["MMSI", "mmsi"]));
  const imo = str(pick(row, ["IMO", "imo"]));
  const name = str(pick(row, ["SHIPNAME", "VESSEL_NAME", "NAME", "name"])) || (mmsi ? `MMSI ${mmsi}` : `MarineTraffic vessel ${idx + 1}`);
  const type = str(pick(row, ["TYPE_NAME", "SHIPTYPE", "VESSEL_TYPE", "TYPE", "type"])) || "AIS vessel";
  const speed = num(pick(row, ["SPEED", "SOG", "speed", "sog"])) ?? 0;
  const heading = num(pick(row, ["HEADING", "COURSE", "COG", "heading", "course"])) ?? 0;
  const flag = str(pick(row, ["FLAG", "COUNTRY", "flag", "country"])) || "Unknown";
  const observedRaw = str(pick(row, ["TIMESTAMP", "LAST_POS", "TIME", "timestamp", "time"]));
  const observedMs = observedRaw ? Date.parse(observedRaw) : NaN;

  return {
    id: `mt-${mmsi || imo || `${name}-${idx}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    flag,
    type,
    mmsi,
    imo,
    callsign: str(pick(row, ["CALLSIGN", "CALL_SIGN", "callsign"])),
    vesselClass: vesselGroup(type) ?? type,
    owner: str(pick(row, ["OWNER", "owner"])),
    operator: str(pick(row, ["OPERATOR", "MANAGER", "operator", "manager"])),
    eta: str(pick(row, ["ETA", "eta"])),
    navStatus: str(pick(row, ["STATUS", "NAV_STATUS", "status", "navStatus"])),
    lat,
    lng,
    speed: Math.max(0, speed),
    heading: Number.isFinite(heading) ? heading : 0,
    category: looksMilitary(name, type) ? "military" : "civilian",
    destination: str(pick(row, ["DESTINATION", "DEST", "destination"])),
    trail: [],
    source: "MarineTraffic",
    sourceUrl: MARINETRAFFIC_DOCS_URL,
    observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : new Date().toISOString(),
  };
}

function unpackRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "vessels", "ships", "rows"]) {
      if (Array.isArray(record[key])) {
        return (record[key] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
      }
    }
  }
  return [];
}

export async function fetchMarineTrafficShips(opts?: { bbox?: Bbox }): Promise<Ship[]> {
  const apiKey = process.env.MARINETRAFFIC_API_KEY?.trim();
  const base = process.env.MARINETRAFFIC_API_URL?.trim();
  if (!apiKey || !base) return [];

  const url = buildMarineTrafficUrl(base, apiKey, opts?.bbox);
  if (!url) return [];

  return withCache(`marinetraffic:${url}`, 60_000, async () => {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`MarineTraffic request failed: ${res.status}`);
    const payload: unknown = await res.json();
    return unpackRows(payload)
      .map(normalizeRow)
      .filter((ship): ship is Ship => Boolean(ship));
  });
}
