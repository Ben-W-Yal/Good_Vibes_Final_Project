# GeoIntel V7

GeoIntel V7 is a real-time geospatial intelligence app that combines live event feeds, tracker feeds, and AI-generated briefing workflows on a 3D Cesium globe.

It is designed for rapid situational awareness:
- View global conflict/news events on a map
- Overlay live aircraft, maritime, and satellite tracks
- Filter by time window, region, and source
- Generate a multi-section Presidential Daily Brief (PDB)
- Export a PDF brief

## What This App Does

### 1) Event intelligence on the globe

The app ingests multiple event providers and normalizes them into a shared `GlobeEntity` model (`src/types/globe.ts`), then renders them in the React client.

Common feeds include:
- `GDELT` (global news-event coverage)
- `ACLED` (structured conflict event data)
- Optional additional news/OSINT sources (depending on your env setup)

### 2) Live tracker overlays

The app can show moving entities on the same map:
- Aircraft (OpenSky and optional additional sources)
- Ships (AISHub / AISStream / optional MarineTraffic)
- Satellites (live TLE-based tracking)

### 3) AI briefing workflow

The Presidential Daily Brief panel generates sectioned intelligence writeups, then supports:
- On-screen briefing review
- PDF export

## High-Level Architecture

- **Frontend:** React + TypeScript (`client/`)
- **Backend:** Express + TypeScript (`server/`, `src/adapters/`)
- **Map engine:** CesiumJS
- **Adapters:** One per provider under `src/adapters`
- **Validation/parsing:** Zod schemas in adapters
- **Caching/throttling:** Server-side TTL cache + request guards for unstable/rate-limited upstreams

Data flow:
1. Client requests `/api/...` routes.
2. Server adapters fetch and normalize external source data.
3. Server returns normalized entities/trackers.
4. Client maps entities to UI event cards + Cesium markers.

## Required Setup

## IMPORTANT: Use your own Gemini API key

To use AI briefing features, you **must** add your own Gemini API key to `.env`.

At minimum, set:

```env
GEMINI_API_KEY=your_google_ai_studio_key_here
```

Without this key, briefing generation and Gemini-backed features will fail.

## Core `.env` checklist

Minimum recommended variables:

```env
GEMINI_API_KEY=...
VITE_CESIUM_ION_TOKEN=...               # optional but recommended for terrain/buildings

GDELT_MAX_ROWS=500
ACLED_MAX_ROWS=80000
```

## Install and Run

1. Install dependencies:
   - `npm install`
2. Configure `.env` (especially `GEMINI_API_KEY`).
3. Start development server:
   - `npm run dev`

Notes:
- `npm run dev` also attempts to auto-start the SpaceMouse Python bridge when port `8765` is free.
- If you only want the app without SpaceMouse bridge startup, use `npm run dev:no-spacemouse`.

## How the Briefing Workflow Works

1. Open the PDB panel and click `Generate Brief`.
2. The server queries Gemini with web-grounded prompts for each briefing section.
3. Results are saved to section state and persisted locally so the last brief remains available.
4. Click `Download PDF` to export the current brief.

## Provider Notes

### OpenSky aircraft feed

- Endpoint: `https://opensky-network.org/api/states/all`
- Route: `/api/trackers/aircraft`
- Optional `.env`:
  - `OPENSKY_USERNAME`
  - `OPENSKY_PASSWORD`

### MarineTraffic ship feed (optional licensed source)

- Route: `/api/trackers/ships`
- Requires:
  - `MARINETRAFFIC_API_KEY`
  - `MARINETRAFFIC_API_URL`

### AISStream ship feed

- Requires:
  - `AISSTREAM_API_KEY`
- Optional:
  - `AISSTREAM_WS_URL`
  - `AISSTREAM_CAPTURE_MS`

## Cesium 3D Enhancements (optional)

```env
VITE_CESIUM_ION_TOKEN=...
VITE_CESIUM_ENABLE_TERRAIN=true
VITE_CESIUM_ENABLE_BUILDINGS=true
```

Without an ion token, the globe still works with reduced terrain/building features.

## SpaceMouse Bridge (optional fallback input mode)

If WebHID is unreliable on your machine:
- Install Python deps:
  - `pip install pyspacemouse websockets`
  - macOS: `brew install hidapi`
- Start app with `npm run dev` (bridge auto-start is attempted)
- Use the `3D Mouse` UI controls in the app

If device-open failures occur, close 3Dconnexion helper processes.

## Troubleshooting

- **Briefing generation fails:** confirm `GEMINI_API_KEY` is valid and server restarted.
- **No GDELT results:** upstream can rate-limit; retry after cooldown and keep limits reasonable.

## Security Note

Do not commit real API secrets to source control. Keep `.env` local/private.
# GeoIntel Ingestion Notes

## Adapter Architecture

This project now includes source adapters under `src/adapters` and a normalized shared type in `src/types/globe.ts`.

- One adapter per feed/provider
- Server-side credential handling only
- Zod payload validation for external data parsing
- TTL caching and dedupe utility helpers

## OpenSky aircraft feed

`/api/trackers/aircraft` now attempts to ingest live ADS-B state vectors from OpenSky Network first, then merges with local `verified-aircraft.json` records.

- Endpoint used: `https://opensky-network.org/api/states/all`
- Cache TTL: 60 seconds (server-side)
- If OpenSky fails or rate limits, API falls back to local verified data only
- Optional auth via `.env`:
  - `OPENSKY_USERNAME`
  - `OPENSKY_PASSWORD`

## MarineTraffic ship feed

`/api/trackers/ships` can merge AISHub, MarineTraffic, and local verified ship records. MarineTraffic is disabled unless API credentials are configured because access requires a licensed API product.

- Adapter: `src/adapters/marinetraffic.ts`
- Cache TTL: 60 seconds
- The client sends the current globe viewport as `bbox`, and the server forwards it to the configured provider URL.
- Required `.env` values:
  - `MARINETRAFFIC_API_KEY=<your licensed API key>`
  - `MARINETRAFFIC_API_URL=<your JSON endpoint from MarineTraffic>`
- `MARINETRAFFIC_API_URL` may use placeholders:
  - `{key}`
  - `{minLon}`
  - `{minLat}`
  - `{maxLon}`
  - `{maxLat}`
- If your endpoint expects the API key as a query parameter instead of a path placeholder, set `MARINETRAFFIC_API_KEY_PARAM` (defaults to `key`).

## AISStream ship feed

`/api/trackers/ships` also supports AISStream as a live source. This uses the AISStream websocket stream with the current viewport bounding box and collects a short burst of positions.

- Adapter: `src/adapters/aisstream.ts`
- Required `.env`:
  - `AISSTREAM_API_KEY=<your key>`
- Optional:
  - `AISSTREAM_WS_URL=wss://stream.aisstream.io/v0/stream`
  - `AISSTREAM_CAPTURE_MS=2500`
- Server-side cache TTL: 15 seconds per viewport tile.

## Liveuamap

Adapter: `src/adapters/liveuamap.ts`, route: `GET /api/liveuamap/events`.

- Set `LIVEUAMAP_API_KEY` and `LIVEUAMAP_BASE_URL` (the full events URL from your Liveuamap developer portal).
- Auth: default `Authorization: Bearer <key>`. If your docs use a query or header key instead, set `LIVEUAMAP_AUTH=query` (optional `LIVEUAMAP_QUERY_PARAM`) or `LIVEUAMAP_AUTH=header`.
- Responses: accepts GeoJSON `FeatureCollection`, `{ events: [...] }`, or similar envelopes; maps coordinates and metadata into `GlobeEntity`.
- Query params appended by the server: `from`, `to`, `region`, `q` (keyword), `limit` — align `LIVEUAMAP_BASE_URL` with what your plan documents (rename in portal if needed).

## Recommended fallback layers

Use these while Liveuamap credentials/docs are unavailable:

- ACLED (structured conflict)
- GDELT (news/event intensity)
- NASA FIRMS (fire/hotspot)

## Cesium ion (optional 3D terrain + buildings)

The globe uses CesiumJS and supports Cesium ion enhancements:

- Real 3D terrain (mountains/relief)
- OSM 3D buildings in supported cities

Add this to `.env`:

- `VITE_CESIUM_ION_TOKEN=<your_free_ion_token>`

Optional toggles:

- `VITE_CESIUM_ENABLE_TERRAIN=true`
- `VITE_CESIUM_ENABLE_BUILDINGS=true`

Without a token, the app falls back to the existing flat ellipsoid terrain.

## SpaceMouse bridge (PySpaceMouse fallback)

If WebHID does not deliver `inputreport` events reliably on your machine, the app can consume SpaceMouse motion from a local Python bridge.

1. Install dependencies:
   - `pip install pyspacemouse websockets`
   - macOS: `brew install hidapi`
2. Start the app:
   - `npm run dev` (auto-starts SpaceMouse bridge if port `8765` is free, then starts app)
   - optional: `npm run dev:no-spacemouse` (app only)
3. Click the `3D Mouse` button.

The client first tries `ws://127.0.0.1:8765` and falls back to WebHID automatically if the bridge is not running.

Optional client env override:

- `VITE_SPACEMOUSE_BRIDGE_URL=ws://127.0.0.1:8765`

If the bridge logs `Failed to open device` repeatedly, the device is usually claimed by 3Dconnexion helper apps. Quit them and retry:

- `killall "3DconnexionHelper" "3DxRadialMenu" "3DxVirtualNumpad"`

