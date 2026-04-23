import { withCache } from "../lib/cache";
import type { Aircraft } from "../../client/src/data/trackers";

const AIRPLANES_LIVE_BASE =
  (process.env.AIRPLANESLIVE_BASE_URL || "https://api.airplanes.live/v2").replace(/\/+$/, "");
const AIRPLANES_LIVE_DOC = "https://airplanes.live/api-guide/";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function normalizeRow(raw: Record<string, unknown>, idx: number): Aircraft | null {
  const lat = num(raw.lat ?? raw.latitude);
  const lon = num(raw.lon ?? raw.lng ?? raw.longitude);
  if (lat == null || lon == null) return null;

  const hex = str(raw.hex ?? raw.icao24)?.toLowerCase();
  const id = `apl-${hex ?? `row-${idx}`}`;

  // API commonly provides feet for altitude and knots for speed.
  const altFt = num(raw.alt_baro ?? raw.alt_geom ?? raw.altitude ?? raw.alt) ?? 0;
  const altitude = altFt > 1000 ? altFt * 0.3048 : altFt;
  const speed = num(raw.gs ?? raw.speed ?? raw.velocity) ?? 0;
  const heading = num(raw.track ?? raw.heading ?? raw.hdg) ?? 0;

  const callsign =
    str(raw.flight ?? raw.callsign ?? raw.call_sign ?? raw.r) ??
    (hex ? hex.toUpperCase() : "UNKNOWN");

  return {
    id,
    callsign: callsign.replace(/\s+/g, "").slice(0, 12) || "UNKNOWN",
    country: str(raw.origin_country ?? raw.country) ?? "Unknown",
    type: str(raw.t ?? raw.type ?? raw.dbFlags) ?? "ADS-B Flight",
    carrier: str(raw.reg ?? raw.registration),
    lat,
    lng: lon,
    altitude,
    speed,
    heading,
    category: "military",
    onGround: typeof raw.ground === "boolean" ? raw.ground : undefined,
    trail: [],
    source: "airplanes.live",
    sourceUrl: AIRPLANES_LIVE_DOC,
    observedAt: new Date().toISOString(),
  };
}

export async function fetchAirplanesLiveAircraft(): Promise<Aircraft[]> {
  // Respect published 1 req/sec guidance by caching for 60s.
  return withCache("airplaneslive:mil:v2", 60_000, async () => {
    const res = await fetch(`${AIRPLANES_LIVE_BASE}/mil`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`airplanes.live request failed: ${res.status}`);
    }
    const payload = (await res.json()) as
      | { ac?: unknown[]; aircraft?: unknown[]; now?: number }
      | unknown[];
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.ac)
        ? payload.ac
        : Array.isArray(payload.aircraft)
          ? payload.aircraft
          : [];

    const out: Aircraft[] = [];
    let i = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const a = normalizeRow(row as Record<string, unknown>, i++);
      if (a) out.push(a);
    }
    return out;
  });
}

