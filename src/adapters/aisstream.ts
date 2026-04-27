import WebSocket from "ws";
import { withCache } from "../lib/cache";
import type { Ship } from "../../client/src/data/trackers";

type Bbox = [number, number, number, number];

const AISSTREAM_DOCS_URL = "https://aisstream.io/";
const DEFAULT_WS_URL = "wss://stream.aisstream.io/v0/stream";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function idStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sanitizeBbox(bbox?: Bbox): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox ?? [-180, -85, 180, 85];
  return [
    Math.max(-180, Math.min(180, minLon)),
    Math.max(-85, Math.min(85, minLat)),
    Math.max(-180, Math.min(180, maxLon)),
    Math.max(-85, Math.min(85, maxLat)),
  ];
}

function shipCategory(name: string, vesselType: string): Ship["category"] {
  const n = `${name} ${vesselType}`.toLowerCase();
  if (/(navy|naval|warship|frigate|destroyer|carrier|coast guard|military)/.test(n)) return "military";
  return "civilian";
}

function maybeIso(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function upsertShipFromPosition(
  ships: Map<string, Ship>,
  staticMeta: Map<string, Record<string, unknown>>,
  meta: Record<string, unknown>,
  pos: Record<string, unknown>,
): void {
  const mmsi = idStr(pos.UserID ?? pos.MMSI ?? meta.MMSI);
  if (!mmsi) return;
  const lat = num(pos.Latitude ?? pos.Lat ?? meta.latitude ?? meta.lat);
  const lng = num(pos.Longitude ?? pos.Lon ?? meta.longitude ?? meta.lon);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  const staticRow = staticMeta.get(mmsi) ?? {};
  const shipName = str(meta.ShipName ?? staticRow.ShipName ?? staticRow.Name) ?? `MMSI ${mmsi}`;
  const vesselType =
    str(meta.ShipType ?? staticRow.ShipType) ??
    str(meta.VesselType ?? staticRow.VesselType) ??
    "AIS vessel";
  const heading = num(pos.TrueHeading ?? pos.Cog ?? pos.Heading) ?? 0;
  const speed = Math.max(0, num(pos.Sog ?? pos.Speed) ?? 0);
  const observedAt = maybeIso(str(meta.time_utc ?? meta.TimeUtc ?? meta.Timestamp));

  const prev = ships.get(mmsi);
  ships.set(mmsi, {
    id: `aisstream-${mmsi}`,
    name: shipName,
    flag: str(meta.Flag ?? staticRow.Flag) ?? "Unknown",
    type: vesselType,
    mmsi,
    imo: idStr(meta.IMO ?? staticRow.IMO),
    callsign: str(meta.CallSign ?? staticRow.CallSign),
    vesselClass: vesselType,
    owner: str(staticRow.Owner),
    operator: str(staticRow.Operator),
    eta: str(meta.ETA ?? staticRow.ETA),
    navStatus: str(pos.NavigationalStatus ?? pos.NavStatus ?? meta.NavigationalStatus),
    lat,
    lng,
    speed,
    heading,
    category: shipCategory(shipName, vesselType),
    destination: str(meta.Destination ?? staticRow.Destination),
    trail: prev?.trail ?? [],
    source: "AISStream",
    sourceUrl: AISSTREAM_DOCS_URL,
    observedAt,
  });
}

export async function fetchAisstreamShips(opts?: { bbox?: Bbox }): Promise<Ship[]> {
  const apiKey = process.env.AISSTREAM_API_KEY?.trim();
  if (!apiKey) return [];

  const wsUrl = process.env.AISSTREAM_WS_URL?.trim() || DEFAULT_WS_URL;
  const captureMs = Math.max(1800, Math.min(15_000, Number(process.env.AISSTREAM_CAPTURE_MS || "6000") || 6000));
  const [minLon, minLat, maxLon, maxLat] = sanitizeBbox(opts?.bbox);
  const cacheKey = `aisstream:${minLon.toFixed(2)},${minLat.toFixed(2)},${maxLon.toFixed(2)},${maxLat.toFixed(2)}`;

  return withCache(cacheKey, 15_000, async () => {
    const shipsByMmsi = new Map<string, Ship>();
    const staticByMmsi = new Map<string, Record<string, unknown>>();

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.close();
        } catch {
          // ignore close failures
        }
        finish();
      }, captureMs);

      ws.on("open", () => {
        const sub = {
          APIKey: apiKey,
          BoundingBoxes: [[[minLat, minLon], [maxLat, maxLon]]],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        };
        ws.send(JSON.stringify(sub));
      });

      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString("utf8")) as unknown;
          const root = asObject(parsed);
          if (!root) return;
          const message = asObject(root.Message) ?? {};
          const meta = asObject(root.MetaData) ?? {};

          const staticMsg = asObject(message.ShipStaticData);
          if (staticMsg) {
            const mmsi = str(staticMsg.UserID ?? staticMsg.MMSI ?? meta.MMSI);
            if (mmsi) staticByMmsi.set(mmsi, staticMsg);
          }

          const posMsg = asObject(message.PositionReport);
          if (posMsg) {
            upsertShipFromPosition(shipsByMmsi, staticByMmsi, meta, posMsg);
          }
        } catch {
          // ignore malformed streaming chunk
        }
      });

      ws.on("error", () => {
        clearTimeout(timer);
        finish();
      });

      ws.on("close", () => {
        clearTimeout(timer);
        finish();
      });
    });

    return Array.from(shipsByMmsi.values());
  });
}

