import { conflictVisualKindFromType } from "./eventVisuals";

// CesiumJS loaded via CDN — access via window.Cesium
export const Cesium = (window as any).Cesium as any;

function envString(name: string): string {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const raw = env?.[name];
  return typeof raw === "string" ? raw.trim() : "";
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const v = envString(name).toLowerCase();
  if (!v) return defaultValue;
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

const CESIUM_ION_TOKEN = envString("VITE_CESIUM_ION_TOKEN");
const ENABLE_ION_TERRAIN = envFlag("VITE_CESIUM_ENABLE_TERRAIN", true);
const ENABLE_ION_BUILDINGS = envFlag("VITE_CESIUM_ENABLE_BUILDINGS", true);
// Keep off by default so map-layer switching remains visible/functional.
const ENABLE_PHOTOREALISTIC_3D_TILES = envFlag("VITE_CESIUM_ENABLE_PHOTOREALISTIC_3D_TILES", false);
const DEFAULT_PHOTOREALISTIC_TILESET_ID = 2275207;
const PHOTOREALISTIC_TILESET_ID = Number(
  envString("VITE_CESIUM_PHOTOREALISTIC_3D_TILESET_ID") || String(DEFAULT_PHOTOREALISTIC_TILESET_ID),
);

type EnhancedViewer = any & {
  __geoIntelPhotoTileset?: any;
  __geoIntelOsmBuildings?: any;
  __geoIntelPhotorealisticEnabled?: boolean;
};

export function photorealisticDefaultEnabled(): boolean {
  return ENABLE_PHOTOREALISTIC_3D_TILES;
}

function setIonToken(): boolean {
  if (!CESIUM_ION_TOKEN || !Cesium?.Ion) return false;
  Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
  return true;
}

async function createPhotorealisticTileset(): Promise<any | null> {
  if (typeof Cesium.createGooglePhotorealistic3DTileset === "function") {
    return await Cesium.createGooglePhotorealistic3DTileset();
  }
  if (
    Number.isFinite(PHOTOREALISTIC_TILESET_ID) &&
    PHOTOREALISTIC_TILESET_ID > 0 &&
    Cesium.Cesium3DTileset?.fromIonAssetId
  ) {
    return await Cesium.Cesium3DTileset.fromIonAssetId(PHOTOREALISTIC_TILESET_ID);
  }
  return null;
}

async function ensureIonTerrain(viewer: any): Promise<void> {
  if (!ENABLE_ION_TERRAIN) return;
  try {
    if (typeof Cesium.createWorldTerrainAsync === "function") {
      viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
    } else if (typeof Cesium.createWorldTerrain === "function") {
      viewer.terrainProvider = Cesium.createWorldTerrain();
    }
    viewer.scene.globe.depthTestAgainstTerrain = true;
  } catch (err) {
    console.warn("[cesium] failed to enable ion terrain:", err);
  }
}

async function ensureIonBuildings(viewer: EnhancedViewer): Promise<void> {
  if (!ENABLE_ION_BUILDINGS || viewer.__geoIntelOsmBuildings) return;
  try {
    if (typeof Cesium.createOsmBuildingsAsync === "function") {
      const buildings = await Cesium.createOsmBuildingsAsync();
      viewer.scene.primitives.add(buildings);
      viewer.__geoIntelOsmBuildings = buildings;
    } else if (typeof Cesium.createOsmBuildings === "function") {
      const buildings = Cesium.createOsmBuildings();
      viewer.scene.primitives.add(buildings);
      viewer.__geoIntelOsmBuildings = buildings;
    }
  } catch (err) {
    console.warn("[cesium] failed to enable ion buildings:", err);
  }
}

function removeIonBuildings(viewer: EnhancedViewer): void {
  if (!viewer.__geoIntelOsmBuildings) return;
  try {
    viewer.scene.primitives.remove(viewer.__geoIntelOsmBuildings);
  } catch {
    // ignore removal issues
  }
  viewer.__geoIntelOsmBuildings = undefined;
}

async function enableIonTerrainAndBuildings(viewer: any): Promise<void> {
  if (!setIonToken()) return;
  const enhanced = viewer as EnhancedViewer;

  if (ENABLE_PHOTOREALISTIC_3D_TILES) {
    try {
      const tileset = await createPhotorealisticTileset();

      if (tileset) {
        removeIonBuildings(enhanced);
        enhanced.__geoIntelPhotoTileset = tileset;
        enhanced.__geoIntelPhotorealisticEnabled = true;
        viewer.scene.primitives.add(tileset);
        // Keep the base globe visible as a fail-safe while photorealistic tiles stream in.
        viewer.scene.globe.show = true;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        return;
      }
      console.warn(
        "[cesium] photorealistic 3D tiles enabled but no supported loader found; using terrain/buildings fallback.",
      );
    } catch (err) {
      console.warn("[cesium] failed to enable photorealistic 3D tiles:", err);
    }
  }

  enhanced.__geoIntelPhotorealisticEnabled = false;
  viewer.scene.globe.show = true;
  await ensureIonTerrain(viewer);
  await ensureIonBuildings(enhanced);
}

export async function setPhotorealistic3DTilesEnabled(viewer: any, enabled: boolean): Promise<boolean> {
  if (!setIonToken()) return false;
  const enhanced = viewer as EnhancedViewer;
  if (enabled) {
    try {
      if (enhanced.__geoIntelPhotorealisticEnabled) {
        viewer.scene.globe.show = true;
        viewer.scene.requestRender?.();
        return true;
      }
      if (!enhanced.__geoIntelPhotoTileset) {
        const tileset = await createPhotorealisticTileset();
        if (!tileset) {
          viewer.scene.globe.show = true;
          await ensureIonTerrain(viewer);
          await ensureIonBuildings(enhanced);
          return false;
        }
        enhanced.__geoIntelPhotoTileset = tileset;
      }
      removeIonBuildings(enhanced);
      viewer.scene.primitives.add(enhanced.__geoIntelPhotoTileset);
      enhanced.__geoIntelPhotorealisticEnabled = true;
      // Do not hide the globe; it prevents blank-earth states if tiles are slow or unavailable.
      viewer.scene.globe.show = true;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.requestRender?.();
      return true;
    } catch (err) {
      console.warn("[cesium] failed to enable photorealistic 3D tiles:", err);
      // Never leave the globe hidden if tiles fail to load/attach.
      enhanced.__geoIntelPhotorealisticEnabled = false;
      viewer.scene.globe.show = true;
      await ensureIonTerrain(viewer);
      await ensureIonBuildings(enhanced);
      viewer.scene.requestRender?.();
      return false;
    }
  }

  try {
    if (enhanced.__geoIntelPhotoTileset) {
      viewer.scene.primitives.remove(enhanced.__geoIntelPhotoTileset);
      // Cesium destroys removed primitives by default; recreate it next time.
      enhanced.__geoIntelPhotoTileset = undefined;
    }
  } catch {
    // ignore removal issues
    enhanced.__geoIntelPhotoTileset = undefined;
  }
  enhanced.__geoIntelPhotorealisticEnabled = false;
  viewer.scene.globe.show = true;
  await ensureIonTerrain(viewer);
  await ensureIonBuildings(enhanced);
  viewer.scene.requestRender?.();
  return true;
}

const CORE_MAP_LAYERS = [
  { id: "osm", label: "Street (OpenStreetMap)" },
  { id: "carto-dark", label: "Dark (CartoDB)" },
  { id: "carto-light", label: "Light (CartoDB)" },
] as const;

const XML_MAP_LAYERS = [
  { id: "xml-bing-maps", label: "Bing - Maps" },
  { id: "xml-bing-satellite", label: "Bing - Satellite" },
  { id: "xml-bing-hybrid", label: "Bing - Hybrid" },
  { id: "xml-google-sat", label: "Google - Satellite Only" },
  { id: "xml-google-hybrid", label: "Google - Hybrid" },
  { id: "xml-google-terrain", label: "Google - Terrain" },
  { id: "xml-google-roadmap-standard", label: "Google - Roadmap Standard" },
  { id: "xml-google-roadmap-alt", label: "Google - Roadmap Alt" },
  { id: "xml-google-roadmap-no-poi", label: "Google - Roadmap No POI" },
  { id: "xml-grg-google-road-overlay", label: "GRG - Google Road Overlay" },
  { id: "xml-grg-google-terrain-overlay", label: "GRG - Google Terrain Overlay" },
  { id: "xml-esri-clarity", label: "Esri - Clarity" },
  { id: "xml-esri-nat-geo", label: "Esri - Nat Geo World" },
  { id: "xml-esri-usa-topo", label: "Esri - USA Topo Maps" },
  { id: "xml-esri-world-topo", label: "Esri - World Topo" },
  { id: "xml-usgs-basemap", label: "USGS - Basemap" },
  { id: "xml-usgs-imagery-only", label: "USGS - Imagery Only" },
  { id: "xml-usgs-imagery-topo", label: "USGS - Imagery Topo" },
  { id: "xml-usgs-shaded-relief", label: "USGS - Shaded Relief" },
  { id: "xml-opentopo", label: "OpenTopoMap" },
  { id: "xml-cycleosm", label: "CycleOSM" },
  { id: "xml-waymarkedtrails-cycle", label: "WaymarkedTrails - Cycling" },
  { id: "xml-openseamap-base", label: "OpenSeaMap - Base Chart" },
  { id: "xml-openseamarks", label: "OpenSeaMap - Seamarks" },
  { id: "xml-mtbmap-europe", label: "MTBMap.cz - Europe" },
] as const;

export const MAP_LAYERS = [...CORE_MAP_LAYERS, ...XML_MAP_LAYERS] as const;
export type MapLayer = (typeof MAP_LAYERS)[number]["id"];

type UrlLayerCfg = {
  url: string;
  maximumLevel: number;
  minimumLevel?: number;
  subdomains?: string[];
  credit?: string;
};

const URL_LAYER_CONFIG: Record<MapLayer, UrlLayerCfg | null> = {
  osm: null,
  "carto-dark": {
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    credit: "© CartoDB",
    maximumLevel: 19,
  },
  "carto-light": {
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    credit: "© CartoDB",
    maximumLevel: 19,
  },
  "xml-bing-maps": null,
  "xml-bing-satellite": null,
  "xml-bing-hybrid": null,
  "xml-google-sat": {
    url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 22,
  },
  "xml-google-hybrid": {
    url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 22,
  },
  "xml-google-terrain": {
    url: "https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-google-roadmap-standard": {
    url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-google-roadmap-alt": {
    url: "https://mt{s}.google.com/vt/lyrs=r&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-google-roadmap-no-poi": {
    url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&s=Gal&apistyle=s.t%3A2%7Cs.e%3Al%7Cp.v%3Aoff",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-grg-google-road-overlay": {
    url: "https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-grg-google-terrain-overlay": {
    url: "https://mt{s}.google.com/vt/lyrs=t&x={x}&y={y}&z={z}",
    subdomains: ["0", "1", "2", "3"],
    maximumLevel: 20,
  },
  "xml-esri-clarity": {
    url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    minimumLevel: 1,
    maximumLevel: 20,
  },
  "xml-esri-nat-geo": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    minimumLevel: 1,
    maximumLevel: 20,
  },
  "xml-esri-usa-topo": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/USA_Topo_Maps/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 15,
  },
  "xml-esri-world-topo": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    minimumLevel: 1,
    maximumLevel: 20,
  },
  "xml-usgs-basemap": {
    url: "https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 15,
  },
  "xml-usgs-imagery-only": {
    url: "https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 15,
  },
  "xml-usgs-imagery-topo": {
    url: "https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 15,
  },
  "xml-usgs-shaded-relief": {
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 15,
  },
  "xml-opentopo": {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    minimumLevel: 1,
    maximumLevel: 17,
  },
  "xml-cycleosm": {
    url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maximumLevel: 21,
  },
  "xml-waymarkedtrails-cycle": {
    url: "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
    maximumLevel: 18,
  },
  "xml-openseamap-base": {
    url: "https://{s}.openseamap.org/tiles/base/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maximumLevel: 18,
  },
  "xml-openseamarks": {
    url: "https://{s}.openseamap.org/seamark/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maximumLevel: 18,
  },
  "xml-mtbmap-europe": {
    url: "http://tile.mtbmap.cz/mtbmap_tiles/{z}/{x}/{y}.png",
    maximumLevel: 21,
  },
};

export function createViewer(container: HTMLElement): any {
  if (!Cesium) throw new Error("CesiumJS not loaded");

  const viewerOptions: any = {
    baseLayerPicker:       false,
    geocoder:              false,
    homeButton:            false,
    sceneModePicker:       false,
    navigationHelpButton:  false,
    animation:             false,
    timeline:              false,
    fullscreenButton:      false,
    selectionIndicator:    false,
    infoBox:               false,
    scene3DOnly:           true,
    shadows:               false,
    shouldAnimate:         true,
  };

  // Older Cesium versions prefer imageryProvider at constructor time.
  try {
    viewerOptions.imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      subdomains: ["0", "1", "2", "3"],
      maximumLevel: 22,
    });
  } catch {
    /* fallback handled below */
  }

  const viewer = new Cesium.Viewer(container, viewerOptions);

  // Keep the default render loop so Scene#preRender (SpaceMouse) runs every frame. Explicit rendering
  // can leave camera motion inert if requestRender is not triggered in edge cases.
  if (typeof viewer.useDefaultRenderLoop === "boolean") {
    viewer.useDefaultRenderLoop = true;
  }
  if (viewer.scene && "requestRenderMode" in viewer.scene) {
    viewer.scene.requestRenderMode = false;
  }

  // Initialize with a simple, version-safe base imagery layer.
  // Some Cesium builds handle constructor-time baseLayer differently.
  try {
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      subdomains: ["0", "1", "2", "3"],
      maximumLevel: 22,
    }));
  } catch {
    /* base imagery optional */
  }

  // Avoid Cesium Ion dependencies by default; local map tiles should work without tokens.
  try {
    if (Cesium.EllipsoidTerrainProvider) {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
  } catch {
    /* terrain optional */
  }

  // Globe settings
  viewer.scene.globe.show = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10;
  // Keep camera "upright" around Earth axis so navigation doesn't drift crooked.
  if (Cesium.Cartesian3?.UNIT_Z) {
    viewer.scene.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
  }
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0001;
  viewer.scene.skyAtmosphere.show = true;

  // Optional ion enhancement (free tier works): real terrain + OSM 3D buildings.
  void enableIonTerrainAndBuildings(viewer);

  return viewer;
}

export function applyMapLayer(viewer: any, layer: MapLayer) {
  const layers = viewer.imageryLayers;
  while (layers.length > 0) layers.remove(layers.get(0));

  const add = (provider: any) => {
    const imageryLayer = layers.addImageryProvider(provider);
    imageryLayer.errorEvent?.addEventListener(() => {
      // Fall back so users never see a blank globe on failed third-party tiles.
      while (layers.length > 0) layers.remove(layers.get(0));
      layers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          maximumLevel: 19,
        }),
      );
    });
    return imageryLayer;
  };

  try {
    if (layer === "osm") {
      add(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          maximumLevel: 19,
        }),
      );
      return;
    }

    if (
      layer === "xml-bing-maps" ||
      layer === "xml-bing-satellite" ||
      layer === "xml-bing-hybrid"
    ) {
      const bingKey = envString("VITE_BING_MAPS_KEY");
      if (!bingKey) {
        throw new Error("Missing VITE_BING_MAPS_KEY for Bing map layers");
      }
      if (!Cesium.BingMapsImageryProvider || !Cesium.BingMapsStyle) {
        throw new Error("Cesium BingMaps provider is unavailable in this build");
      }
      const style =
        layer === "xml-bing-hybrid"
          ? Cesium.BingMapsStyle.AERIAL_WITH_LABELS
          : layer === "xml-bing-satellite"
            ? Cesium.BingMapsStyle.AERIAL
            : Cesium.BingMapsStyle.ROAD;

      add(
        new Cesium.BingMapsImageryProvider({
          url: "https://dev.virtualearth.net",
          key: bingKey,
          mapStyle: style,
        }),
      );
      return;
    }

    const cfg = URL_LAYER_CONFIG[layer];
    if (!cfg) throw new Error(`No map-layer config for ${layer}`);
    add(
      new Cesium.UrlTemplateImageryProvider({
        url: cfg.url,
        maximumLevel: cfg.maximumLevel,
        ...(cfg.minimumLevel !== undefined ? { minimumLevel: cfg.minimumLevel } : {}),
        ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
        ...(cfg.credit ? { credit: cfg.credit } : {}),
      }),
    );
  } catch {
    // Hard fallback for provider-construction errors.
    while (layers.length > 0) layers.remove(layers.get(0));
    layers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        maximumLevel: 19,
      }),
    );
  }
}

// --- SVG icon helpers (returned as base64 data URIs for Cesium billboards) ---
function b64(svg: string) {
  return "data:image/svg+xml;base64," + btoa(svg);
}

export function eventBillboard(color: string, type: string): string {
  const kind = conflictVisualKindFromType(type);
  let inner = `<circle cx="10" cy="10" r="4" fill="white" opacity="0.9"/>`;
  if (kind === "missile") {
    inner = `<path d="M10 4 L12 10 L10 9 L8 10 Z" fill="white"/>
             <path d="M6 10 L14 10 L13 11 L7 11 Z" fill="white" opacity="0.7"/>`;
  } else if (kind === "drone") {
    inner = `<circle cx="6.8" cy="6.8" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="13.2" cy="6.8" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="6.8" cy="13.2" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="13.2" cy="13.2" r="1.7" stroke="white" stroke-width="1"/>
             <rect x="8.4" y="8.4" width="3.2" height="3.2" rx="0.5" fill="white"/>`;
  } else if (kind === "airstrike") {
    inner = `<path d="M10 4 L12 9 L10 8 L8 9 Z" fill="white"/>
             <path d="M5 8 L10 10 L15 8 L14 9 L10 8 L6 9 Z" fill="white" opacity="0.7"/>`;
  } else if (kind === "explosion") {
    inner = `<circle cx="10" cy="11" r="3.2" fill="white"/>
             <path d="M13 7L15.5 4.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
             <path d="M12.4 8L14.2 9.6" stroke="white" stroke-width="1.2" stroke-linecap="round"/>`;
  } else if (kind === "ground") {
    inner = `<path d="M7 7 L13 13 M13 7 L7 13" stroke="white" stroke-width="2" stroke-linecap="round"/>`;
  } else if (kind === "maritime") {
    inner = `<ellipse cx="10" cy="11" rx="4" ry="5" fill="none" stroke="white" stroke-width="1.5"/>
             <path d="M10 5 L12 8 L8 8 Z" fill="white"/>`;
  } else if (kind === "protest") {
    inner = `<circle cx="10" cy="7" r="2.5" fill="white"/>
             <rect x="7.5" y="10" width="5" height="5" rx="1" fill="white"/>`;
  } else if (kind === "cyber" || kind === "political") {
    inner = `<rect x="6" y="6" width="8" height="8" rx="1" fill="none" stroke="white" stroke-width="1.5"/>
             <line x1="8" y1="9" x2="12" y2="9" stroke="white" stroke-width="1.5"/>
             <line x1="10" y1="7" x2="10" y2="13" stroke="white" stroke-width="1.5"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="9" fill="${color}" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
    ${inner}
  </svg>`;
  return b64(svg);
}

export function aircraftIcon(color: string, heading: number, military: boolean): string {
  const shape = military
    ? `<g transform="rotate(${heading}, 16, 16)">
        <path d="M16 22 L16 29" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity="0.38"/>
        <path d="M16 24 L16 31" stroke="white" stroke-width="0.8" stroke-linecap="round" opacity="0.28"/>
        <path d="M16 4 L18.4 14.6 L27 19 L26.2 21.2 L17.9 18.8 L16 25 L14.1 18.8 L5.8 21.2 L5 19 L13.6 14.6 Z" fill="${color}" stroke="white" stroke-width="1"/>
        <path d="M16 5 L17.2 15 L16 14.2 L14.8 15 Z" fill="white" opacity="0.75"/>
        <circle cx="16" cy="17" r="1.7" fill="white" opacity="0.85"/>
      </g>`
    : `<g transform="rotate(${heading}, 16, 16)">
        <path d="M16 22 L16 29" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity="0.38"/>
        <path d="M16 24 L16 31" stroke="white" stroke-width="0.8" stroke-linecap="round" opacity="0.28"/>
        <path d="M16 4 C17 4 17.8 5.1 18 6.7 L19 14.8 L27 19.2 L26.2 21.4 L18 19.1 L17.2 24.5 L20.4 26.1 L19.8 27.5 L16 26.4 L12.2 27.5 L11.6 26.1 L14.8 24.5 L14 19.1 L5.8 21.4 L5 19.2 L13 14.8 L14 6.7 C14.2 5.1 15 4 16 4 Z" fill="${color}" stroke="white" stroke-width="1"/>
        <path d="M15 6.5 L17 6.5 L17.7 14.8 L16 14 L14.3 14.8 Z" fill="white" opacity="0.7"/>
      </g>`;
  return b64(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${shape}</svg>`);
}

export function shipIcon(color: string, heading: number, military: boolean): string {
  const shape = military
    ? `<g transform="rotate(${heading}, 11, 11)">
        <rect x="7" y="4" width="8" height="14" rx="2" fill="${color}" stroke="white" stroke-width="0.8"/>
        <polygon points="11,1 13,4 9,4" fill="${color}" stroke="white" stroke-width="0.8"/>
        <rect x="9" y="7" width="4" height="3" fill="rgba(255,255,255,0.5)"/>
        <line x1="11" y1="4" x2="11" y2="7" stroke="white" stroke-width="1.2"/>
      </g>`
    : `<g transform="rotate(${heading}, 11, 11)">
        <ellipse cx="11" cy="12" rx="4" ry="7" fill="${color}" stroke="white" stroke-width="0.8"/>
        <polygon points="11,3 13,7 9,7" fill="${color}" stroke="white" stroke-width="0.8"/>
        <line x1="11" y1="7" x2="11" y2="13" stroke="white" stroke-width="1"/>
      </g>`;
  return b64(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${shape}</svg>`);
}

export function satelliteIcon(color: string, name = ""): string {
  const isIss = /international space station|iss/i.test(name);
  if (isIss) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="34" viewBox="0 0 52 34">
      <g transform="rotate(-13 26 17)">
        <line x1="6" y1="17" x2="46" y2="17" stroke="#d8dee9" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="26" y1="7" x2="26" y2="27" stroke="#d8dee9" stroke-width="1" stroke-linecap="round"/>

        <rect x="1.5" y="9" width="7.5" height="16" rx="0.7" fill="#172554" stroke="#e6edf3" stroke-width="0.7"/>
        <rect x="10" y="8" width="7.5" height="17" rx="0.7" fill="#1e1b4b" stroke="#e6edf3" stroke-width="0.7"/>
        <rect x="34.5" y="8" width="7.5" height="17" rx="0.7" fill="#1e1b4b" stroke="#e6edf3" stroke-width="0.7"/>
        <rect x="43" y="9" width="7.5" height="16" rx="0.7" fill="#172554" stroke="#e6edf3" stroke-width="0.7"/>

        <line x1="4" y1="12" x2="16" y2="11.5" stroke="#475569" stroke-width="0.6"/>
        <line x1="4" y1="16" x2="16" y2="15.5" stroke="#475569" stroke-width="0.6"/>
        <line x1="4" y1="20" x2="16" y2="19.5" stroke="#475569" stroke-width="0.6"/>
        <line x1="36" y1="11.5" x2="48" y2="12" stroke="#475569" stroke-width="0.6"/>
        <line x1="36" y1="15.5" x2="48" y2="16" stroke="#475569" stroke-width="0.6"/>
        <line x1="36" y1="19.5" x2="48" y2="20" stroke="#475569" stroke-width="0.6"/>

        <rect x="21" y="13" width="10" height="7" rx="1.3" fill="#c9d1d9" stroke="white" stroke-width="0.9"/>
        <circle cx="24" cy="16.5" r="2.3" fill="#8b949e" stroke="white" stroke-width="0.7"/>
        <circle cx="29" cy="16.5" r="1.8" fill="#8b949e" stroke="white" stroke-width="0.7"/>
        <rect x="23" y="8.5" width="6" height="4" rx="0.8" fill="#c9d1d9" stroke="white" stroke-width="0.7"/>
        <rect x="22.5" y="20" width="7" height="4.5" rx="0.8" fill="#c9d1d9" stroke="white" stroke-width="0.7"/>
        <path d="M31 15 L37 12.5 M31 19 L37 22" stroke="#d8dee9" stroke-width="0.8" stroke-linecap="round"/>
        <path d="M21 15 L15 12.5 M21 19 L15 22" stroke="#d8dee9" stroke-width="0.8" stroke-linecap="round"/>
        <circle cx="38" cy="12.2" r="1" fill="#e6edf3"/>
        <circle cx="14" cy="22.2" r="1" fill="#e6edf3"/>
      </g>
    </svg>`;
    return b64(svg);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <g transform="rotate(-18 14 14)">
      <rect x="11" y="10" width="6" height="8" rx="1.2" fill="${color}" stroke="white" stroke-width="1"/>
      <rect x="3" y="9" width="7" height="10" rx="0.8" fill="${color}" opacity="0.72" stroke="white" stroke-width="0.8"/>
      <rect x="18" y="9" width="7" height="10" rx="0.8" fill="${color}" opacity="0.72" stroke="white" stroke-width="0.8"/>
      <line x1="10" y1="14" x2="11" y2="14" stroke="white" stroke-width="1"/>
      <line x1="17" y1="14" x2="18" y2="14" stroke="white" stroke-width="1"/>
      <circle cx="14" cy="12.2" r="0.9" fill="white" opacity="0.9"/>
      <path d="M13.2 18 L14 22 L14.8 18" stroke="white" stroke-width="0.9" stroke-linecap="round"/>
    </g>
  </svg>`;
  return b64(svg);
}

// Region camera positions
export const REGION_VIEWS: Record<string, { lng: number; lat: number; alt: number }> = {
  Global:       { lng: -10, lat: 25, alt: 22_000_000 },
  Ukraine:      { lng: 33,  lat: 49, alt: 1_800_000 },
  "Middle East":{ lng: 38,  lat: 28, alt: 3_500_000 },
  Asia:         { lng: 110, lat: 30, alt: 8_000_000 },
  Africa:       { lng: 22,  lat: 5,  alt: 8_000_000 },
  Americas:     { lng: -98, lat: 39, alt: 13_716_000 },
  Europe:       { lng: 15,  lat: 52, alt: 5_000_000 },
};
