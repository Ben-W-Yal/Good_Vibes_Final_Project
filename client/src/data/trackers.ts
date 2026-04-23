export interface Aircraft {
  id: string;
  callsign: string;
  country: string;
  type: string;
  carrier?: string;
  lat: number;
  lng: number;
  altitude: number; // meters
  speed: number;    // knots
  heading: number;  // degrees
  category: "civilian" | "military";
  /** From ADS-B when available (e.g. OpenSky state vector). */
  onGround?: boolean;
  trail: { lat: number; lng: number }[];
  source: string;
  sourceUrl: string;
  observedAt: string; // ISO timestamp
}

export interface Ship {
  id: string;
  name: string;
  flag: string;
  type: string;
  lat: number;
  lng: number;
  speed: number; // knots
  heading: number;
  category: "civilian" | "military";
  destination?: string;
  trail: { lat: number; lng: number }[];
  source: string;
  sourceUrl: string;
  observedAt: string; // ISO timestamp
}

export interface Satellite {
  id: string;
  name: string;
  country: string;
  category: "communications" | "weather" | "military" | "navigation" | "scientific";
  orbit: "LEO" | "MEO" | "GEO" | "HEO";
  lat: number;
  lng: number;
  altitude: number; // km
  trail: { lat: number; lng: number }[];
  source: string;
  sourceUrl: string;
  observedAt: string; // ISO timestamp
}

export const SAT_COLORS: Record<Satellite["category"], string> = {
  communications: "#8957e5",
  weather:        "#39c5cf",
  military:       "#f85149",
  navigation:     "#3fb950",
  scientific:     "#d29922",
};
