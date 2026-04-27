import type { EventType, GeoEvent } from "../data/events";

export const EVENT_TYPE_FILTERS: EventType[] = [
  "Airstrike",
  "Missile Strike",
  "Drone Strike",
  "Rocket Attack",
  "Explosion",
  "Bombing",
  "Ground Clashes",
  "Ambush",
  "Attack",
  "Shooting",
  "Maritime Incident",
  "Missile Test",
  "Protest",
  "Earthquake",
  "Cyber",
  "Political",
  "Economic",
  "Legislation",
  "Policy",
  "Military Operation",
  "Border Skirmish",
  "Military Exercise",
  "Military Deployment",
  "Deployment",
  "Training",
];

export type RegionFilterKey =
  | "africa"
  | "europe"
  | "middle-east"
  | "asia"
  | "north-america"
  | "south-america"
  | "indo-pacific"
  | "other";

export function effectiveEventLookbackHours(
  source: string,
  timeRangeHours: number,
): number {
  if (source === "ACLED") {
    // Keep ACLED visible regardless filter slider; account/API tier controls recency.
    return 24 * 3650;
  }
  return timeRangeHours;
}

export const REGION_FILTERS: Array<{ key: RegionFilterKey; label: string }> = [
  { key: "africa", label: "Africa" },
  { key: "europe", label: "Europe" },
  { key: "middle-east", label: "Middle East" },
  { key: "asia", label: "Asia" },
  { key: "north-america", label: "North America" },
  { key: "south-america", label: "South America" },
  { key: "indo-pacific", label: "Indo-Pacific" },
  { key: "other", label: "Other" },
];

function inferRegionBucket(ev: GeoEvent): RegionFilterKey {
  const text = `${ev.region} ${ev.country}`.toLowerCase();

  if (
    text.includes("indo-pacific") ||
    text.includes("indo pacific") ||
    text.includes("taiwan") ||
    text.includes("philippines") ||
    text.includes("pacific")
  ) {
    return "indo-pacific";
  }
  if (
    text.includes("middle east") ||
    text.includes("gaza") ||
    text.includes("israel") ||
    text.includes("lebanon") ||
    text.includes("iran") ||
    text.includes("iraq") ||
    text.includes("syria") ||
    text.includes("yemen") ||
    text.includes("uae")
  ) {
    return "middle-east";
  }
  if (
    text.includes("africa") ||
    text.includes("sudan") ||
    text.includes("congo") ||
    text.includes("nigeria") ||
    text.includes("ethiopia") ||
    text.includes("kenya") ||
    text.includes("somalia")
  ) {
    return "africa";
  }
  if (
    text.includes("europe") ||
    text.includes("eastern europe") ||
    text.includes("ukraine") ||
    text.includes("russia") ||
    text.includes("estonia") ||
    text.includes("france") ||
    text.includes("germany") ||
    text.includes("poland")
  ) {
    return "europe";
  }
  if (
    text.includes("south america") ||
    text.includes("venezuela") ||
    text.includes("guyana") ||
    text.includes("brazil") ||
    text.includes("argentina") ||
    text.includes("colombia")
  ) {
    return "south-america";
  }
  if (
    text.includes("north america") ||
    text.includes("united states") ||
    text.includes("canada") ||
    text.includes("mexico") ||
    text.includes("hampton roads")
  ) {
    return "north-america";
  }
  if (
    text.includes("asia") ||
    text.includes("china") ||
    text.includes("japan") ||
    text.includes("india") ||
    text.includes("korea") ||
    text.includes("pakistan")
  ) {
    return "asia";
  }
  return "other";
}

export function matchesRegionFilter(ev: GeoEvent, activeRegions: RegionFilterKey[]): boolean {
  if (activeRegions.length === 0) return true;
  return activeRegions.includes(inferRegionBucket(ev));
}
