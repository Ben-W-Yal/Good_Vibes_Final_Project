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

