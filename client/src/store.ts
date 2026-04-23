import { create } from "zustand";
import type { GeoEvent, Severity, Category } from "./data/events";
import type { Aircraft, Ship, Satellite } from "./data/trackers";
import type { GlobeSource } from "../../src/types/globe";
import type { AircraftCocomMask } from "./data/cocoms";
import { emptyAircraftCocomMask } from "./data/cocoms";

export type MapLayer =
  | "osm"
  | "carto-dark"
  | "esri-street"
  | "carto-light"
  | "xml-google-sat"
  | "xml-google-hybrid"
  | "xml-google-terrain"
  | "xml-noaa-rnc";
export type ActiveRegion = "Global" | "Ukraine" | "Middle East" | "Asia" | "Africa" | "Americas" | "Europe";

// Tracker type keys used in filter toggles
export type TrackerType = "aircraft" | "ships" | "satellites";
export type TrackerAffiliation = "all" | "civilian" | "military";
export type AircraftGroundMode = "all" | "airborne" | "ground";
export type AircraftSourceFilter = "all" | "opensky" | "verified";
export type TrackerSelection =
  | { kind: "aircraft"; data: Aircraft }
  | { kind: "ships"; data: Ship }
  | { kind: "satellites"; data: Satellite };

export interface Filters {
  // Use arrays for easy iteration/serialization
  categories: Category[];
  severities: Severity[];
  trackerTypes: TrackerType[];
  trackerAffiliations: Record<TrackerType, TrackerAffiliation>;
  aircraftMaxVisible: number;
  aircraftShowLabels: boolean;
  aircraftGroundMode: AircraftGroundMode;
  aircraftAltMinFt: number;
  aircraftAltMaxFt: number;
  aircraftSpeedMinKt: number;
  aircraftSpeedMaxKt: number;
  aircraftCallsignQuery: string;
  aircraftCountryQuery: string;
  aircraftSourceFilter: AircraftSourceFilter;
  /** When all false, aircraft are not limited by COCOM AOR. Any true = show only inside union of enabled AORs. */
  aircraftCocoms: AircraftCocomMask;
  sources: GlobeSource[];
  timeRangeHours: number;
  /** ISO 639-1 codes for news feeds. Default English only. */
  newsLanguages: string[];
}

interface AppState {
  // Map
  mapLayer: MapLayer;
  setMapLayer: (l: MapLayer) => void;
  activeRegion: ActiveRegion;
  setActiveRegion: (r: ActiveRegion) => void;

  // Tracker data
  aircraft: Aircraft[];
  ships: Ship[];
  satellites: Satellite[];
  setAircraft: (d: Aircraft[]) => void;
  setShips: (d: Ship[]) => void;
  setSatellites: (d: Satellite[]) => void;

  // Events
  events: GeoEvent[];
  setEvents: (d: GeoEvent[]) => void;
  liveuamapStatus: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  };
  setLiveuamapStatus: (status: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  }) => void;
  perigonStatus: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  };
  setPerigonStatus: (status: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  }) => void;
  acledStatus: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  };
  setAcledStatus: (status: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  }) => void;

  // Filters
  filters: Filters;
  setFilters: (partial: Partial<Filters>) => void;
  setTrackerAffiliation: (t: TrackerType, a: TrackerAffiliation) => void;
  setTimeRangeHours: (h: number) => void;
  toggleCategory: (c: Category) => void;
  toggleSeverity: (s: Severity) => void;

  // Selection
  selectedEvent: GeoEvent | null;
  selectEvent: (e: GeoEvent | null) => void;
  selectedTracker: TrackerSelection | null;
  selectTracker: (t: TrackerSelection | null) => void;

  // Panels — consistent naming: show* + setShow*
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  showBriefing: boolean;
  setShowBriefing: (v: boolean) => void;
  showTrackers: boolean;
  setShowTrackers: (v: boolean) => void;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
}

const ALL_CATEGORIES: Category[] = ["conflict", "domestic", "local", "social"];
const ALL_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const DEFAULT_TRACKER_TYPES: TrackerType[] = [];
const ALL_SOURCES: GlobeSource[] = [
  "acled",
  "gdelt",
  "liveuamap",
  "perigon",
  "ai",
  "thenewsapi",
];

export const useStore = create<AppState>((set) => ({
  // Map
  mapLayer: "xml-google-sat",
  setMapLayer: (mapLayer) => set({ mapLayer }),
  activeRegion: "Global",
  setActiveRegion: (activeRegion) => set({ activeRegion }),

  // Data
  aircraft: [],
  ships: [],
  satellites: [],
  events: [],
  setAircraft: (aircraft) => set({ aircraft }),
  setShips: (ships) => set({ ships }),
  setSatellites: (satellites) => set({ satellites }),
  setEvents: (events) => set({ events }),
  liveuamapStatus: { state: "idle", message: "Not checked yet" },
  setLiveuamapStatus: (liveuamapStatus) => set({ liveuamapStatus }),
  perigonStatus: { state: "idle", message: "Not checked yet" },
  setPerigonStatus: (perigonStatus) => set({ perigonStatus }),
  acledStatus: { state: "idle", message: "Not checked yet" },
  setAcledStatus: (acledStatus) => set({ acledStatus }),

  // Filters
  filters: {
    categories: [...ALL_CATEGORIES],
    severities: [...ALL_SEVERITIES],
    trackerTypes: [...DEFAULT_TRACKER_TYPES],
    trackerAffiliations: {
      aircraft: "all",
      ships: "all",
      satellites: "all",
    },
    aircraftMaxVisible: 300,
    aircraftShowLabels: false,
    aircraftGroundMode: "all",
    aircraftAltMinFt: 0,
    aircraftAltMaxFt: 60_000,
    aircraftSpeedMinKt: 0,
    aircraftSpeedMaxKt: 800,
    aircraftCallsignQuery: "",
    aircraftCountryQuery: "",
    aircraftSourceFilter: "all",
    aircraftCocoms: emptyAircraftCocomMask(),
    sources: [...ALL_SOURCES],
    // Default news window: last 24 hours.
    timeRangeHours: 24,
    newsLanguages: ["en"],
  },
  setFilters: (partial) =>
    set((s) => ({ filters: { ...s.filters, ...partial } })),
  setTrackerAffiliation: (type, affiliation) =>
    set((s) => ({
      filters: {
        ...s.filters,
        trackerAffiliations: {
          ...s.filters.trackerAffiliations,
          [type]: affiliation,
        },
      },
    })),
  setTimeRangeHours: (timeRangeHours) =>
    set((s) => ({ filters: { ...s.filters, timeRangeHours } })),
  toggleCategory: (c) =>
    set((s) => {
      const cats = s.filters.categories.includes(c)
        ? s.filters.categories.filter((x) => x !== c)
        : [...s.filters.categories, c];
      return { filters: { ...s.filters, categories: cats } };
    }),
  toggleSeverity: (sv) =>
    set((s) => {
      const sevs = s.filters.severities.includes(sv)
        ? s.filters.severities.filter((x) => x !== sv)
        : [...s.filters.severities, sv];
      return { filters: { ...s.filters, severities: sevs } };
    }),

  // Selection
  selectedEvent: null,
  selectEvent: (selectedEvent) => set({ selectedEvent, sidebarOpen: true }),
  selectedTracker: null,
  selectTracker: (selectedTracker) => set({ selectedTracker }),

  // Panels
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  showBriefing: false,
  setShowBriefing: (showBriefing) => set({ showBriefing }),
  showTrackers: false,
  setShowTrackers: (showTrackers) => set({ showTrackers }),
  showFilters: false,
  setShowFilters: (showFilters) => set({ showFilters }),
}));
