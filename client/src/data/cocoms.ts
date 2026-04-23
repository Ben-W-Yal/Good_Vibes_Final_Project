/**
 * Approximate geographic AOR boxes for U.S. geographic combatant commands (COCOMs).
 * Used only for client-side aircraft filtering — not authoritative boundaries.
 * Sources: public DoD AOR maps (simplified to axis-aligned rectangles; overlaps exist).
 */

export type AircraftCocomId =
  | "NORTHCOM"
  | "SOUTHCOM"
  | "EUCOM"
  | "AFRICOM"
  | "CENTCOM"
  | "INDOPACOM";

export type CocomBbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export type AircraftCocomMask = Record<AircraftCocomId, boolean>;

export const AIRCRAFT_COCOM_ORDER: AircraftCocomId[] = [
  "NORTHCOM",
  "SOUTHCOM",
  "EUCOM",
  "AFRICOM",
  "CENTCOM",
  "INDOPACOM",
];

export const COCOM_META: Record<
  AircraftCocomId,
  { short: string; hint: string; boxes: CocomBbox[] }
> = {
  NORTHCOM: {
    short: "NORTHCOM",
    hint: "North America & Arctic approaches (contiguous U.S., Canada, Mexico, Alaska)",
    boxes: [
      { minLng: -168, minLat: 15, maxLng: -50, maxLat: 72 },
      { minLng: -170, minLat: 51, maxLng: -126, maxLat: 72 },
    ],
  },
  SOUTHCOM: {
    short: "SOUTHCOM",
    hint: "Caribbean, Central & South America",
    boxes: [{ minLng: -120, minLat: -56, maxLng: -30, maxLat: 15 }],
  },
  EUCOM: {
    short: "EUCOM",
    hint: "Europe, Israel, Levant overlap with CENTCOM possible",
    boxes: [{ minLng: -31, minLat: 35, maxLng: 42, maxLat: 72 }],
  },
  AFRICOM: {
    short: "AFRICOM",
    hint: "Africa (excluding Egypt overlap handled by union)",
    boxes: [{ minLng: -25, minLat: -35, maxLng: 55, maxLat: 38 }],
  },
  CENTCOM: {
    short: "CENTCOM",
    hint: "Middle East, Levant, Gulf, Central & South Asia",
    boxes: [{ minLng: 24, minLat: 8, maxLng: 78, maxLat: 45 }],
  },
  INDOPACOM: {
    short: "INDOPACOM",
    hint: "Indo-Pacific (split boxes for dateline)",
    boxes: [
      { minLng: 60, minLat: -55, maxLng: 180, maxLat: 72 },
      { minLng: -180, minLat: -55, maxLng: -102, maxLat: 72 },
    ],
  },
};

export function emptyAircraftCocomMask(): AircraftCocomMask {
  return {
    NORTHCOM: false,
    SOUTHCOM: false,
    EUCOM: false,
    AFRICOM: false,
    CENTCOM: false,
    INDOPACOM: false,
  };
}

function inBbox(lng: number, lat: number, b: CocomBbox): boolean {
  return lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

/** True if any COCOM toggle is on. */
export function aircraftCocomFilterActive(mask: AircraftCocomMask): boolean {
  return AIRCRAFT_COCOM_ORDER.some((id) => mask[id]);
}

/**
 * When no COCOM is selected, returns true (no geographic restriction).
 * When one or more are selected, position must fall inside the union of their boxes.
 */
export function aircraftInEnabledCocoms(lng: number, lat: number, mask: AircraftCocomMask): boolean {
  if (!aircraftCocomFilterActive(mask)) return true;
  for (const id of AIRCRAFT_COCOM_ORDER) {
    if (!mask[id]) continue;
    for (const box of COCOM_META[id].boxes) {
      if (inBbox(lng, lat, box)) return true;
    }
  }
  return false;
}
