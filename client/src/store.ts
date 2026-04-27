import { create } from "zustand";
import type { GeoEvent, EventType } from "./data/events";
import type { Aircraft, Ship, Satellite } from "./data/trackers";
import type { GlobeSource } from "../../src/types/globe";
import type { AircraftCocomMask } from "./data/cocoms";
import { emptyAircraftCocomMask } from "./data/cocoms";
import type { RegionFilterKey } from "./lib/eventFilters";
import { EVENT_TYPE_FILTERS, REGION_FILTERS } from "./lib/eventFilters";
import type { MapLayer as CesiumMapLayer } from "./lib/cesium";

export type MapLayer = CesiumMapLayer;
export type ActiveRegion = "Global" | "Ukraine" | "Middle East" | "Asia" | "Africa" | "Americas" | "Europe";

// Tracker type keys used in filter toggles
export type TrackerType = "aircraft" | "ships" | "satellites";
export type TrackerAffiliation =
  | "all"
  | "civilian"
  | "military"
  | "airlines"
  | "commercial"
  | "cargo"
  | "tanker"
  | "passenger"
  | "fishing"
  | "other";
export type AircraftGroundMode = "all" | "airborne" | "ground";
export type AircraftSourceFilter = "all" | "opensky" | "verified";
export type ViewBbox = [number, number, number, number];
export type TrackerSelection =
  | { kind: "aircraft"; data: Aircraft }
  | { kind: "ships"; data: Ship }
  | { kind: "satellites"; data: Satellite };

export interface Filters {
  // Use arrays for easy iteration/serialization
  eventTypes: EventType[];
  regions: RegionFilterKey[];
  trackerTypes: TrackerType[];
  trackerAffiliations: Record<TrackerType, TrackerAffiliation>;
  aircraftMaxVisible: number;
  /** Cap ship billboards (performance); API may return more before slice. */
  shipsMaxVisible: number;
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
  satelliteShowOrbits: boolean;
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
  aircraftViewportBbox: ViewBbox | null;
  setAircraft: (d: Aircraft[]) => void;
  setShips: (d: Ship[]) => void;
  setSatellites: (d: Satellite[]) => void;
  setAircraftViewportBbox: (bbox: ViewBbox | null) => void;

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
  gdeltStatus: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  };
  setGdeltStatus: (status: {
    state: "idle" | "enabled" | "disabled" | "error";
    message: string;
    lastUpdated?: string;
  }) => void;
  acledNextCursor: string | null;
  acledHasMore: boolean;
  acledLoadingMore: boolean;
  acledQueryKey: string;
  setAcledPaging: (partial: {
    nextCursor?: string | null;
    hasMore?: boolean;
    loadingMore?: boolean;
    queryKey?: string;
  }) => void;

  // Filters
  filters: Filters;
  setFilters: (partial: Partial<Filters>) => void;
  setTrackerAffiliation: (t: TrackerType, a: TrackerAffiliation) => void;
  setTimeRangeHours: (h: number) => void;

  // Selection
  selectedEvent: GeoEvent | null;
  selectEvent: (e: GeoEvent | null) => void;
  selectedTracker: TrackerSelection | null;
  selectTracker: (t: TrackerSelection | null) => void;
  watchlistEventIds: string[];
  toggleWatchlistEvent: (eventId: string) => void;

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

const DEFAULT_TRACKER_TYPES: TrackerType[] = [];
const ALL_SOURCES: GlobeSource[] = [
  "acled",
  "gdelt",
];

export const useStore = create<AppState>((set) => ({
  // Map
  mapLayer: "xml-google-sat",
  setMapLayer: (mapLayer) => set({ mapLayer }),
  activeRegion: "Americas",
  setActiveRegion: (activeRegion) => set({ activeRegion }),

  // Data
  aircraft: [],
  ships: [],
  satellites: [],
  aircraftViewportBbox: [-170, -56, -30, 72],
  events: [],
  setAircraft: (aircraft) => set({ aircraft }),
  setShips: (ships) => set({ ships }),
  setSatellites: (satellites) => set({ satellites }),
  setAircraftViewportBbox: (aircraftViewportBbox) => set({ aircraftViewportBbox }),
  setEvents: (events) => set({ events }),
  liveuamapStatus: { state: "idle", message: "Not checked yet" },
  setLiveuamapStatus: (liveuamapStatus) => set({ liveuamapStatus }),
  perigonStatus: { state: "idle", message: "Not checked yet" },
  setPerigonStatus: (perigonStatus) => set({ perigonStatus }),
  acledStatus: { state: "idle", message: "Not checked yet" },
  setAcledStatus: (acledStatus) => set({ acledStatus }),
  gdeltStatus: { state: "idle", message: "Not checked yet" },
  setGdeltStatus: (gdeltStatus) => set({ gdeltStatus }),
  acledNextCursor: null,
  acledHasMore: false,
  acledLoadingMore: false,
  acledQueryKey: "",
  setAcledPaging: (partial) =>
    set((s) => ({
      acledNextCursor:
        partial.nextCursor !== undefined ? partial.nextCursor : s.acledNextCursor,
      acledHasMore: partial.hasMore !== undefined ? partial.hasMore : s.acledHasMore,
      acledLoadingMore:
        partial.loadingMore !== undefined ? partial.loadingMore : s.acledLoadingMore,
      acledQueryKey: partial.queryKey !== undefined ? partial.queryKey : s.acledQueryKey,
    })),

  // Filters
  filters: {
    eventTypes: [...EVENT_TYPE_FILTERS],
    regions: REGION_FILTERS.map((r) => r.key),
    trackerTypes: [...DEFAULT_TRACKER_TYPES],
    trackerAffiliations: {
      aircraft: "all",
      ships: "all",
      satellites: "all",
    },
    aircraftMaxVisible: 25_000,
    shipsMaxVisible: 25_000,
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
    satelliteShowOrbits: false,
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

  // Selection
  selectedEvent: null,
  selectEvent: (selectedEvent) => set({ selectedEvent, sidebarOpen: true }),
  selectedTracker: null,
  selectTracker: (selectedTracker) => set({ selectedTracker }),
  watchlistEventIds: [],
  toggleWatchlistEvent: (eventId) =>
    set((s) => {
      const has = s.watchlistEventIds.includes(eventId);
      return {
        watchlistEventIds: has
          ? s.watchlistEventIds.filter((id) => id !== eventId)
          : [...s.watchlistEventIds, eventId],
      };
    }),

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
