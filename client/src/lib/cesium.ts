// CesiumJS loaded via CDN — access via window.Cesium
export const Cesium = (window as any).Cesium as any;

export type MapLayer =
  | "osm"
  | "carto-dark"
  | "esri-street"
  | "carto-light"
  | "xml-google-sat"
  | "xml-google-hybrid"
  | "xml-google-terrain"
  | "xml-noaa-rnc";

export const MAP_LAYERS: { id: MapLayer; label: string }[] = [
  { id: "osm",           label: "Street (OpenStreetMap)" },
  { id: "carto-dark",   label: "Dark (CartoDB)" },
  { id: "esri-street",  label: "Imagery + Labels (ESRI)" },
  { id: "carto-light",  label: "Light (CartoDB)" },
  { id: "xml-google-sat", label: "Google Sat" },
  { id: "xml-google-hybrid", label: "Google Hybrid" },
  { id: "xml-google-terrain", label: "Google Terrain" },
  { id: "xml-noaa-rnc", label: "NOAA RNC (WMS)" },
];

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
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0001;
  viewer.scene.skyAtmosphere.show = true;

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
    switch (layer) {
      case "osm":
        add(new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/", maximumLevel: 19 }));
        break;
      case "carto-dark":
        add(new Cesium.UrlTemplateImageryProvider({ url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", credit: "© CartoDB", maximumLevel: 19 }));
        break;
      case "carto-light":
        add(new Cesium.UrlTemplateImageryProvider({ url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", credit: "© CartoDB", maximumLevel: 19 }));
        break;
      case "esri-street":
        add(new Cesium.ArcGisMapServerImageryProvider({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer", maximumLevel: 19 }));
        break;
      case "xml-google-sat":
        add(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            subdomains: ["0", "1", "2", "3"],
            maximumLevel: 22,
          }),
        );
        break;
      case "xml-google-hybrid":
        add(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
            subdomains: ["0", "1", "2", "3"],
            maximumLevel: 22,
          }),
        );
        break;
      case "xml-google-terrain":
        add(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://mt{s}.google.com/vt/lyrs=t,r&hl=en&x={x}&y={y}&z={z}",
            maximumLevel: 15,
            subdomains: ["0", "1", "2", "3"],
          }),
        );
        break;
      case "xml-noaa-rnc":
        add(
          new Cesium.WebMapServiceImageryProvider({
            url: "https://seamlessrnc.nauticalcharts.noaa.gov/arcgis/services/RNC/NOAA_RNC/ImageServer/WMSServer",
            layers: "0",
            parameters: {
              styles: "default",
              transparent: true,
              format: "image/png",
            },
          }),
        );
        break;
    }
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
  // Pick inner symbol
  let inner = `<circle cx="10" cy="10" r="4" fill="white" opacity="0.9"/>`;

  if (type.includes("Missile") || type.includes("Rocket")) {
    inner = `<path d="M10 4 L12 10 L10 9 L8 10 Z" fill="white"/>
             <path d="M6 10 L14 10 L13 11 L7 11 Z" fill="white" opacity="0.7"/>`;
  } else if (type.includes("Drone")) {
    inner = `<circle cx="6.8" cy="6.8" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="13.2" cy="6.8" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="6.8" cy="13.2" r="1.7" stroke="white" stroke-width="1"/>
             <circle cx="13.2" cy="13.2" r="1.7" stroke="white" stroke-width="1"/>
             <rect x="8.4" y="8.4" width="3.2" height="3.2" rx="0.5" fill="white"/>`;
  } else if (type.includes("Airstrike") || type.includes("Strike")) {
    inner = `<path d="M10 4 L12 9 L10 8 L8 9 Z" fill="white"/>
             <path d="M5 8 L10 10 L15 8 L14 9 L10 8 L6 9 Z" fill="white" opacity="0.7"/>`;
  } else if (type.includes("Bomb") || type.includes("Explosion")) {
    inner = `<circle cx="10" cy="11" r="3.2" fill="white"/>
             <path d="M13 7L15.5 4.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
             <path d="M12.4 8L14.2 9.6" stroke="white" stroke-width="1.2" stroke-linecap="round"/>`;
  } else if (type.includes("Shooting") || type.includes("Attack")) {
    inner = `<path d="M4 12L10.2 9.8L11.2 10.8L15 9.8L12.4 7.2L11 5.8L10 7.8L9 8.8L4 12Z" fill="white"/>`;
  } else if (type.includes("Clash") || type.includes("Ground") || type.includes("Ambush")) {
    inner = `<path d="M7 7 L13 13 M13 7 L7 13" stroke="white" stroke-width="2" stroke-linecap="round"/>`;
  } else if (type.includes("Maritime")) {
    inner = `<ellipse cx="10" cy="11" rx="4" ry="5" fill="none" stroke="white" stroke-width="1.5"/>
             <path d="M10 5 L12 8 L8 8 Z" fill="white"/>`;
  } else if (type.includes("Protest")) {
    inner = `<circle cx="10" cy="7" r="2.5" fill="white"/>
             <rect x="7.5" y="10" width="5" height="5" rx="1" fill="white"/>`;
  } else if (type.includes("Cyber") || type.includes("Economic")) {
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
    ? `<g transform="rotate(${heading}, 12, 12)">
        <polygon points="12,2 14,9 12,8 10,9" fill="${color}" stroke="white" stroke-width="0.8"/>
        <polygon points="4,9 12,11 20,9 19,11 12,9 5,11" fill="${color}" stroke="white" stroke-width="0.5"/>
        <polygon points="8,14 12,13 16,14 14,18 12,15 10,18" fill="${color}" stroke="white" stroke-width="0.5"/>
      </g>`
    : `<g transform="rotate(${heading}, 12, 12)">
        <polygon points="12,2 14,10 12,9 10,10" fill="${color}" stroke="white" stroke-width="0.8"/>
        <polygon points="3,10 12,12 21,10 19,11 12,10 5,11" fill="${color}" stroke="white" stroke-width="0.5"/>
        <polygon points="9,16 12,15 15,16 13.5,18.5 12,17 10.5,18.5" fill="${color}" stroke="white" stroke-width="0.5"/>
      </g>`;
  return b64(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${shape}</svg>`);
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

export function satelliteIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="2.5" fill="${color}" stroke="white" stroke-width="1"/>
    <line x1="1" y1="9" x2="5" y2="9" stroke="${color}" stroke-width="2"/>
    <line x1="13" y1="9" x2="17" y2="9" stroke="${color}" stroke-width="2"/>
    <rect x="1" y="7" width="4" height="4" rx="0.5" fill="${color}" opacity="0.75" stroke="white" stroke-width="0.5"/>
    <rect x="13" y="7" width="4" height="4" rx="0.5" fill="${color}" opacity="0.75" stroke="white" stroke-width="0.5"/>
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
  Americas:     { lng: -75, lat: 20, alt: 12_000_000 },
  Europe:       { lng: 15,  lat: 52, alt: 5_000_000 },
};
