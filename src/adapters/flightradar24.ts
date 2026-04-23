import { withCache } from "../lib/cache";
import type { Aircraft } from "../../client/src/data/trackers";

const FR24_DOC = "https://fr24api.flightradar24.com/docs/endpoints/overview";

/** [minLon, minLat, maxLon, maxLat] → FR24 `bounds` string `N,S,W,E` */
export function bboxToFr24Bounds(bbox: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return `${maxLat},${minLat},${minLon},${maxLon}`;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * FR24 "light" payload fields vary slightly; normalize altitude (often feet) → meters, speed → knots.
 */
function fr24RowToAircraft(raw: Record<string, unknown>, idx: number): Aircraft | null {
  const lat = num(raw.latitude ?? raw.lat);
  const lon = num(raw.longitude ?? raw.lon ?? raw.lng);
  if (lat == null || lon == null) return null;

  const hex = str(raw.hex ?? raw.icao24)?.toLowerCase();
  const fr24Id = str(raw.fr24_id ?? raw.flight_id) ?? `noid-${idx}`;
  const idKey = hex ?? fr24Id;

  let altRaw = num(raw.altitude ?? raw.alt ?? raw.geometric_altitude) ?? 0;
  if (altRaw > 2000 && altRaw < 60_000) altRaw *= 0.3048;

  let spd = num(raw.gspeed ?? raw.speed ?? raw.gs) ?? 0;
  if (spd > 0 && spd < 120) spd *= 1.94384449;

  const hdg = num(raw.track ?? raw.heading ?? raw.hdg) ?? 0;
  const callsign = str(raw.callsign ?? raw.call_sign) ?? str(raw.flight) ?? "UNKNOWN";
  const reg = str(raw.registration ?? raw.reg);
  const type = str(raw.aircraft ?? raw.aircraft_model) ?? "Flight position";

  return {
    id: `fr24-${idKey}`,
    callsign: callsign.replace(/\s+/g, "").slice(0, 12) || "UNKNOWN",
    country: str(raw.origin_country ?? raw.origin) ?? "Unknown",
    type,
    carrier: reg,
    lat,
    lng: lon,
    altitude: altRaw,
    speed: spd,
    heading: hdg,
    category: "civilian",
    trail: [],
    source: "Flightradar24",
    sourceUrl: FR24_DOC,
    observedAt: new Date().toISOString(),
  };
}

export function flightradar24Enabled(): boolean {
  return Boolean(process.env.FR24_API_TOKEN?.trim());
}

/**
 * Live positions (light) inside geographic bounds. Requires paid FR24 API subscription + credits.
 * @see https://fr24api.flightradar24.com/docs/sdk/js
 */
export async function fetchFlightradar24Aircraft(
  bbox: [number, number, number, number],
  limit: number,
): Promise<Aircraft[]> {
  const token = process.env.FR24_API_TOKEN?.trim();
  if (!token) return [];

  const bounds = bboxToFr24Bounds(bbox);
  const cap = Math.min(Math.max(1, limit), 200);
  const cacheKey = `fr24:live:light:${bounds}:${cap}`;

  return withCache(cacheKey, 45_000, async () => {
    const { Client } = await import("@flightradar24/fr24sdk");
    const client = new Client({ apiToken: token, apiVersion: "v1" });
    try {
      const rows = await client.live.getLight({ bounds, limit: cap });
      const out: Aircraft[] = [];
      let i = 0;
      for (const row of rows) {
        let raw: Record<string, unknown> | null = null;
        try {
          raw = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
        } catch {
          raw = row && typeof row === "object" ? ({ ...(row as object) } as Record<string, unknown>) : null;
        }
        if (!raw) continue;
        const a = fr24RowToAircraft(raw, i++);
        if (a) out.push(a);
      }
      return out;
    } finally {
      client.close();
    }
  });
}

/** ICAO hex from our synthetic ids (OpenSky `os-XXXX`, FR24 `fr24-XXXX`). */
export function aircraftHexFromId(id: string): string | null {
  if (id.startsWith("os-")) return id.slice(3).toLowerCase();
  if (id.startsWith("apl-")) {
    const rest = id.slice(4);
    if (/^[0-9a-f]{6}$/i.test(rest)) return rest.toLowerCase();
  }
  if (id.startsWith("fr24-")) {
    const rest = id.slice(5);
    if (/^[0-9a-f]{6}$/i.test(rest)) return rest.toLowerCase();
  }
  return null;
}
