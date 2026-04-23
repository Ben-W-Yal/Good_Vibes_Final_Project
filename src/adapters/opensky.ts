import { z } from "zod";
import { withCache } from "../lib/cache";
import type { Aircraft } from "../../client/src/data/trackers";

const stateVectorSchema = z.tuple([
  z.string(), // icao24
  z.string().nullable(), // callsign
  z.string().nullable(), // origin_country
  z.number().nullable(), // time_position
  z.number().nullable(), // last_contact
  z.number().nullable(), // longitude
  z.number().nullable(), // latitude
  z.number().nullable(), // baro_altitude
  z.boolean().nullable(), // on_ground
  z.number().nullable(), // velocity m/s
  z.number().nullable(), // true_track
  z.number().nullable(), // vertical_rate
  z.array(z.number()).nullable(), // sensors
  z.number().nullable(), // geo_altitude
  z.string().nullable(), // squawk
  z.boolean().nullable(), // spi
  z.number().nullable(), // position_source
]);

const openSkyResponseSchema = z.object({
  time: z.number(),
  states: z.array(stateVectorSchema).nullable(),
});

type OpenSkyResponse = z.infer<typeof openSkyResponseSchema>;

const OPENSKY_DOCS_URL = "https://openskynetwork.github.io/opensky-api/";

function mpsToKnots(v: number): number {
  return v * 1.94384449;
}

function toAircraft(rows: OpenSkyResponse): Aircraft[] {
  const observedAt = new Date(rows.time * 1000).toISOString();
  const states = rows.states ?? [];
  const out: Aircraft[] = [];
  for (const s of states) {
      const [icao24, callsign, originCountry, , , lon, lat, baroAlt, onGround, velocity, trueTrack, , , geoAlt] = s;
      if (lat == null || lon == null) continue;
      const altitude = geoAlt ?? baroAlt ?? 0;
      const speed = velocity == null ? 0 : mpsToKnots(velocity);
      out.push({
        id: `os-${icao24}`,
        callsign: (callsign ?? icao24).trim(),
        country: originCountry ?? "Unknown",
        type: "ADS-B State Vector",
        carrier: undefined,
        lat,
        lng: lon,
        altitude,
        speed,
        heading: trueTrack ?? 0,
        category: "civilian" as const,
        onGround: onGround ?? undefined,
        trail: [],
        source: "OpenSky Network",
        sourceUrl: OPENSKY_DOCS_URL,
        observedAt,
      });
  }
  return out;
}

export async function fetchOpenSkyAircraft(): Promise<Aircraft[]> {
  const base = "https://opensky-network.org/api/states/all";
  const user = process.env.OPENSKY_USERNAME;
  const pass = process.env.OPENSKY_PASSWORD;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (user && pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  return withCache("opensky:states:all", 60_000, async () => {
    const res = await fetch(base, { headers });
    if (!res.ok) {
      throw new Error(`OpenSky request failed: ${res.status}`);
    }
    const payload = openSkyResponseSchema.parse(await res.json());
    return toAircraft(payload);
  });
}

