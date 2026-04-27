/**
 * Re-export shared headline geocoder for GDELT / Perigon / etc.
 * @see shared/textGeo.ts
 */
export type { TextGeoHit, GeoJitterSpread } from "@shared/textGeo";
export { textGeoLookup, jitterLatLng } from "@shared/textGeo";
