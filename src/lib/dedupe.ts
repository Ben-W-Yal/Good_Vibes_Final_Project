import type { GlobeEntity } from "../types/globe";
import { haversineMeters } from "./geo";

export function dedupeById(entities: GlobeEntity[]): GlobeEntity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    if (seen.has(`${e.source}:${e.id}`)) return false;
    seen.add(`${e.source}:${e.id}`);
    return true;
  });
}

export function dedupeNearIdentical(
  entities: GlobeEntity[],
  distanceMeters = 1500,
  timeWindowMs = 30 * 60 * 1000,
): GlobeEntity[] {
  const kept: GlobeEntity[] = [];
  for (const e of entities) {
    const ts = new Date(e.timestamp).getTime();
    const exists = kept.some((k) => {
      const kts = new Date(k.timestamp).getTime();
      if (Math.abs(ts - kts) > timeWindowMs) return false;
      const sameLabel = (e.label || "").trim().toLowerCase() === (k.label || "").trim().toLowerCase();
      if (!sameLabel) return false;
      return haversineMeters(e.lat, e.lon, k.lat, k.lon) <= distanceMeters;
    });
    if (!exists) kept.push(e);
  }
  return kept;
}

