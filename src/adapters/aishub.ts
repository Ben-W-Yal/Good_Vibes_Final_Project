import { z } from "zod";
import { withCache } from "../lib/cache";
import type { Ship } from "../../client/src/data/trackers";

const DEFAULT_BASE = "https://data.aishub.net/ws.php";
const DOCS_URL = "https://www.aishub.net/api";

const shipRowSchema = z
  .object({
    MMSI: z.union([z.string(), z.number()]).optional(),
    NAME: z.string().optional(),
    COUNTRY: z.string().optional(),
    TYPE: z.union([z.string(), z.number()]).optional(),
    LATITUDE: z.number().optional(),
    LONGITUDE: z.number().optional(),
    SOG: z.union([z.number(), z.string()]).optional(),
    HEADING: z.union([z.number(), z.string()]).optional(),
    DEST: z.string().optional(),
    TIME: z.string().optional(),
  })
  .passthrough();

type AishubRow = z.infer<typeof shipRowSchema>;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function looksMilitary(name: string, typeCode: number | null): boolean {
  if (typeCode === 35) return true; // AIS vessel type: military ops
  const n = name.toLowerCase();
  return (
    n.includes("navy") ||
    n.includes("warship") ||
    n.includes("frigate") ||
    n.includes("destroyer") ||
    n.includes("carrier")
  );
}

function parseObservedAt(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const t = Date.parse(raw.replace(" GMT", "Z"));
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function normalizeRow(row: AishubRow): Ship | null {
  const lat = asNumber(row.LATITUDE);
  const lng = asNumber(row.LONGITUDE);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const mmsi = row.MMSI != null ? String(row.MMSI).trim() : "";
  if (!mmsi) return null;
  const name = (row.NAME || "").trim() || `MMSI ${mmsi}`;
  const typeCode = asNumber(row.TYPE);
  const speedRaw = asNumber(row.SOG);
  const headingRaw = asNumber(row.HEADING);
  const speed = speedRaw == null || speedRaw >= 102.4 ? 0 : Math.max(0, speedRaw);
  const heading = headingRaw == null || headingRaw >= 360 ? 0 : headingRaw;

  return {
    id: `aishub-${mmsi}`,
    name,
    flag: (row.COUNTRY || "Unknown").trim() || "Unknown",
    type: typeCode == null ? "AIS vessel" : `AIS type ${typeCode}`,
    lat,
    lng,
    speed,
    heading,
    category: looksMilitary(name, typeCode) ? "military" : "civilian",
    destination: (row.DEST || "").trim() || undefined,
    trail: [],
    source: "AISHub",
    sourceUrl: DOCS_URL,
    observedAt: parseObservedAt(row.TIME),
  };
}

function unpackRows(payload: unknown): AishubRow[] {
  if (Array.isArray(payload)) {
    // Typical shape: [meta, [rows...]]
    if (payload.length >= 2 && Array.isArray(payload[1])) {
      return payload[1].map((r) => shipRowSchema.parse(r));
    }
    return payload.map((r) => shipRowSchema.parse(r));
  }
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data.map((r) => shipRowSchema.parse(r));
    if (Array.isArray(record.vessels)) return record.vessels.map((r) => shipRowSchema.parse(r));
  }
  return [];
}

export async function fetchAishubShips(opts?: {
  bbox?: [number, number, number, number];
  intervalMinutes?: number;
}): Promise<Ship[]> {
  const username = process.env.AISHUB_USERNAME?.trim();
  if (!username) return [];

  const base = (process.env.AISHUB_BASE_URL || DEFAULT_BASE).trim() || DEFAULT_BASE;
  const interval =
    opts?.intervalMinutes ??
    Math.max(1, Math.min(120, Number(process.env.AISHUB_INTERVAL_MINUTES || "15") || 15));

  const params = new URLSearchParams();
  params.set("username", username);
  params.set("format", "1"); // human-readable units
  params.set("output", "json");
  params.set("compress", "0");
  params.set("interval", String(interval));
  if (opts?.bbox) {
    const [minLon, minLat, maxLon, maxLat] = opts.bbox;
    params.set("latmin", String(minLat));
    params.set("latmax", String(maxLat));
    params.set("lonmin", String(minLon));
    params.set("lonmax", String(maxLon));
  }

  const url = `${base}?${params.toString()}`;
  return withCache(`aishub:${url}`, 60_000, async () => {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`AISHub request failed: ${res.status}`);
    const payload: unknown = await res.json();
    const rows = unpackRows(payload);
    const out: Ship[] = [];
    for (const row of rows) {
      const ship = normalizeRow(row);
      if (ship) out.push(ship);
    }
    return out;
  });
}

