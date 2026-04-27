import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  Cesium, createViewer, applyMapLayer,
  eventBillboard, aircraftIcon, shipIcon, satelliteIcon,
  setPhotorealistic3DTilesEnabled as setPhotorealisticTilesMode,
  REGION_VIEWS,
} from "../lib/cesium";
import { SEVERITY_COLOR } from "../data/events";
import { SAT_COLORS } from "../data/trackers";
import type { Aircraft, Ship, Satellite } from "../data/trackers";
import type { GlobeSource } from "../../../src/types/globe";
import { effectiveEventLookbackHours, matchesRegionFilter } from "../lib/eventFilters";
import { getControlConfig, getMotion, initSpaceMouseAutoReconnect } from "../lib/spacemouse";

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<any>(null);
  const entityMap    = useRef<Map<string, any>>(new Map());
  const trailPrims   = useRef<any[]>([]);
  const photoTilesEnabledRef = useRef<boolean | null>(null);
  const mapLayerRef = useRef<string>("");
  const [initError, setInitError] = useState<string | null>(null);
  const [cameraHud, setCameraHud] = useState({
    headingDeg: 0,
    pitchDeg: -68.8,
    rollDeg: 0,
    altitudeFt: 0,
    altitudeM: 0,
    altitudeMi: 0,
  });

  const {
    mapLayer, activeRegion,
    events, aircraft, ships, satellites,
    filters, selectedEvent, selectedTracker, selectEvent, selectTracker,
    setAircraftViewportBbox,
  } = useStore();

  useEffect(() => {
    mapLayerRef.current = mapLayer;
  }, [mapLayer]);

  const matchesAffiliation = (type: "aircraft" | "ships" | "satellites", isMilitary: boolean) => {
    const mode = filters.trackerAffiliations[type];
    if (mode === "all") return true;
    if (mode === "military") return isMilitary;
    if (mode === "airlines" || mode === "other") return !isMilitary;
    return !isMilitary;
  };

  const looksLikeAirlineFlight = (a: Aircraft): boolean => {
    if (a.category === "military") return false;
    const callsign = a.callsign.replace(/\s+/g, "").toUpperCase();
    // Airline ADS-B callsigns are commonly ICAO airline prefixes plus digits
    // (e.g. DAL123, AAL42, UAL990). Registrations/private callsigns usually do not match this.
    return /^[A-Z]{2,3}\d{1,4}[A-Z]?$/.test(callsign);
  };

  const matchesAircraftAffiliation = (a: Aircraft): boolean => {
    const mode = filters.trackerAffiliations.aircraft;
    const isMilitary = a.category === "military";
    const isAirline = looksLikeAirlineFlight(a);
    if (mode === "all") return true;
    if (mode === "military") return isMilitary;
    if (mode === "civilian") return !isMilitary;
    if (mode === "airlines") return isAirline;
    if (mode === "other") return !isMilitary && !isAirline;
    return true;
  };

  const matchesShipAffiliation = (s: Ship): boolean => {
    const mode = filters.trackerAffiliations.ships;
    const isMilitary = s.category === "military";
    const type = `${s.vesselClass ?? ""} ${s.type}`.toLowerCase();
    const isCargo = /(cargo|container|bulk|general cargo)/.test(type);
    const isTanker = /(tanker|lng|lpg|oil|chemical)/.test(type);
    const isPassenger = /(passenger|cruise|ferry)/.test(type);
    const isFishing = /fishing/.test(type);
    if (mode === "all") return true;
    if (mode === "military") return isMilitary;
    if (mode === "civilian" || mode === "commercial") return !isMilitary;
    if (mode === "cargo") return !isMilitary && isCargo;
    if (mode === "tanker") return !isMilitary && isTanker;
    if (mode === "passenger") return !isMilitary && isPassenger;
    if (mode === "fishing") return !isMilitary && isFishing;
    if (mode === "other") return !isMilitary && !isCargo && !isTanker && !isPassenger && !isFishing;
    return true;
  };

  const ftToM = (ft: number) => ft * 0.3048;
  const DEFAULT_EARTH_ALTITUDE_FT = 45_000_000;
  const DEFAULT_EARTH_ALTITUDE_M = ftToM(DEFAULT_EARTH_ALTITUDE_FT);
  const DEFAULT_LEVEL_PITCH_RAD = -1.2;
  const NADIR_PITCH_RAD = -Math.PI / 2 + 0.0001;
  const PHOTOREALISTIC_ENABLE_HEIGHT_M = 1_500_000;

  /**
   * When computeViewRectangle is undefined (tilted camera, transitions), derive a bbox from
   * globe pick samples so ship/aircraft feeds still match what you are looking at — otherwise
   * the store can keep a stale bbox (e.g. Americas) while the camera is over the Middle East.
   */
  const bboxFromGlobePicks = (viewer: any): [number, number, number, number] | null => {
    const w = viewer.canvas?.clientWidth ?? 0;
    const h = viewer.canvas?.clientHeight ?? 0;
    if (w < 8 || h < 8) return null;
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const pts = [
      new Cesium.Cartesian2(w * 0.5, h * 0.5),
      new Cesium.Cartesian2(w * 0.12, h * 0.12),
      new Cesium.Cartesian2(w * 0.88, h * 0.12),
      new Cesium.Cartesian2(w * 0.12, h * 0.88),
      new Cesium.Cartesian2(w * 0.88, h * 0.88),
    ];
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let hits = 0;
    for (const p of pts) {
      const ray = viewer.camera.getPickRay(p);
      if (!ray) continue;
      const cart = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cart) continue;
      const c = Cesium.Cartographic.fromCartesian(cart, ellipsoid);
      if (!c) continue;
      const la = Cesium.Math.toDegrees(c.latitude);
      const lo = Cesium.Math.toDegrees(c.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      hits++;
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLon = Math.min(minLon, lo);
      maxLon = Math.max(maxLon, lo);
    }
    if (hits < 2) return null;
    return [minLon, minLat, maxLon, maxLat];
  };

  const publishAircraftViewportBbox = () => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    try {
      const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      let west: number;
      let south: number;
      let east: number;
      let north: number;
      if (rect) {
        west = Cesium.Math.toDegrees(rect.west);
        south = Cesium.Math.toDegrees(rect.south);
        east = Cesium.Math.toDegrees(rect.east);
        north = Cesium.Math.toDegrees(rect.north);
      } else {
        const picked = bboxFromGlobePicks(viewer);
        if (!picked) return;
        [west, south, east, north] = picked;
      }
      if (![west, south, east, north].every(Number.isFinite)) return;

      west = Math.max(-180, Math.min(180, west));
      east = Math.max(-180, Math.min(180, east));
      south = Math.max(-85, Math.min(85, south));
      north = Math.max(-85, Math.min(85, north));
      if (east < west) {
        west = -180;
        east = 180;
      }
      // Pad the view rect so feeds include traffic just outside the frustum (smoother panning, denser fills).
      const lonSpan = east - west;
      const latSpan = north - south;
      const padFrac = 0.32;
      const lonPad = Math.min(42, lonSpan * padFrac);
      const latPad = Math.min(26, latSpan * padFrac);
      west = Math.max(-180, west - lonPad);
      east = Math.min(180, east + lonPad);
      south = Math.max(-85, south - latPad);
      north = Math.min(85, north + latPad);
      const prev = useStore.getState().aircraftViewportBbox;
      if (prev && [west, south, east, north].every((v, i) => Math.abs(v - prev[i]) < 0.08)) return;
      setAircraftViewportBbox([west, south, east, north]);
    } catch {
      // View rectangle can be undefined during camera transitions.
    }
  };

  // ── Initialize viewer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;
    if (!Cesium) {
      setInitError("Cesium script did not load.");
      return;
    }

    try {
      setInitError(null);
      const viewer = createViewer(containerRef.current);
      viewerRef.current = viewer;

      // Initial camera
      const startView = REGION_VIEWS["Americas"];
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(startView.lng, startView.lat, startView.alt),
        orientation: {
          heading: 0,
          // Start north-up and straight down so the USA opens level.
          pitch: NADIR_PITCH_RAD,
          roll: 0,
        },
        duration: 0,
      });

      // Click handler
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      const orbitDrag = {
        active: false,
        target: null as any | null,
        startX: 0,
        startY: 0,
        heading: 0,
        pitch: 0,
        range: 0,
      };

      handler.setInputAction((e: any) => {
        const picked = viewer.scene.pick(e.position);
        if (Cesium.defined(picked) && picked.id?.properties?.eventJSON) {
          try {
            const val = picked.id.properties.eventJSON;
            const raw = typeof val.getValue === "function" ? val.getValue(Cesium.JulianDate.now()) : val;
            const evt = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
            useStore.getState().selectEvent(evt);
            useStore.getState().selectTracker(null);
          } catch { /* */ }
          return;
        }
        if (Cesium.defined(picked) && picked.id?.properties?.trackerJSON) {
          try {
            const val = picked.id.properties.trackerJSON;
            const raw = typeof val.getValue === "function" ? val.getValue(Cesium.JulianDate.now()) : val;
            const tracker = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
            useStore.getState().selectEvent(null);
            useStore.getState().selectTracker(tracker);
          } catch { /* */ }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Google Earth-style orbit around a picked 3D point:
      // hold Shift + Left Drag to rotate/tilt around that anchor.
      handler.setInputAction((e: any) => {
        const pos = e.position;
        if (!pos) return;
        const target =
          (viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(pos) : null) ||
          viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
        if (!target) return;

        orbitDrag.active = true;
        orbitDrag.target = target;
        orbitDrag.startX = pos.x;
        orbitDrag.startY = pos.y;
        orbitDrag.heading = viewer.camera.heading;
        orbitDrag.pitch = viewer.camera.pitch;
        orbitDrag.range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
      }, Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.KeyboardEventModifier.SHIFT);

      handler.setInputAction((e: any) => {
        if (!orbitDrag.active || !orbitDrag.target) return;
        const end = e.endPosition;
        if (!end) return;

        const dx = end.x - orbitDrag.startX;
        const dy = end.y - orbitDrag.startY;
        const heading = orbitDrag.heading + dx * 0.005;
        const pitch = Math.max(-1.52, Math.min(-0.03, orbitDrag.pitch + dy * 0.0035));
        const range = Math.max(80, orbitDrag.range);

        viewer.camera.lookAt(
          orbitDrag.target,
          new Cesium.HeadingPitchRange(heading, pitch, range),
        );
        viewer.scene.requestRender();
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE, Cesium.KeyboardEventModifier.SHIFT);

      handler.setInputAction(() => {
        if (!orbitDrag.active) return;
        orbitDrag.active = false;
        orbitDrag.target = null;
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.scene.requestRender();
      }, Cesium.ScreenSpaceEventType.LEFT_UP, Cesium.KeyboardEventModifier.SHIFT);

      // Keyboard navigation
      const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          snapNorthUp();
          return;
        }
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          resetTiltZero();
          return;
        }
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          snapNorthUp();
          resetTiltZero();
          return;
        }
        const cam = viewer.camera;
        const spd = e.shiftKey ? 500_000 : 100_000;
        switch (e.key) {
          case "w": case "W": cam.moveForward(spd); break;
          case "s": case "S": cam.moveBackward(spd); break;
          case "a": case "A": cam.moveLeft(spd); break;
          case "d": case "D": cam.moveRight(spd); break;
          case "q": case "Q": cam.lookLeft(0.02); break;
          case "e": case "E": cam.lookRight(0.02); break;
          case "f": case "F": cam.moveDown(spd); break;
          case "+": case "=": cam.zoomIn(spd); break;
          case "-": case "_": cam.zoomOut(spd); break;
          case "0": {
            const v = REGION_VIEWS["Global"];
            cam.flyTo({ destination: Cesium.Cartesian3.fromDegrees(v.lng, v.lat, v.alt), duration: 2 });
            break;
          }
        }
        viewer.scene.requestRender();
      };
      document.addEventListener("keydown", onKey);
      let aircraftBboxTimer: number | null = null;
      const onCameraChanged = () => {
        if (aircraftBboxTimer !== null) return;
        aircraftBboxTimer = window.setTimeout(() => {
          aircraftBboxTimer = null;
          publishAircraftViewportBbox();
        }, 300);
      };
      const removeCameraChanged = viewer.camera.changed.addEventListener(onCameraChanged);
      publishAircraftViewportBbox();

      // SpaceMouse must attach to this viewer instance — a separate effect with [] misses
      // the viewer after React Strict Mode remounts or if init order differs.
      void initSpaceMouseAutoReconnect();
      const onSpaceMotion = () => viewer.scene.requestRender();
      let spaceConfig = getControlConfig();
      const onSpaceConfig = (ev: Event) => {
        const detail = (ev as CustomEvent<ReturnType<typeof getControlConfig>>).detail;
        spaceConfig = detail ?? getControlConfig();
      };
      let spaceLastNow = performance.now();
      let spaceLastHudUpdate = 0;
      let spaceLastAircraftBboxUpdate = 0;

      const onSpacePreRender = () => {
        const now = performance.now();
        const dt = Math.max(0.001, Math.min(0.05, (now - spaceLastNow) / 1000));
        spaceLastNow = now;
        const cam = viewer.camera;

        if (now - spaceLastHudUpdate > 120) {
          const headingDeg = ((Cesium.Math.toDegrees(cam.heading) % 360) + 360) % 360;
          const pitchDeg = Cesium.Math.toDegrees(cam.pitch);
          const rollDeg = Cesium.Math.toDegrees(cam.roll);
          const altitudeM = Math.max(0, cam.positionCartographic?.height ?? 0);
          const altitudeFt = altitudeM * 3.28084;
          const altitudeMi = altitudeM / 1609.344;
          setCameraHud((prev) => {
            const changed =
              Math.abs(prev.headingDeg - headingDeg) > 0.1 ||
              Math.abs(prev.pitchDeg - pitchDeg) > 0.1 ||
              Math.abs(prev.rollDeg - rollDeg) > 0.1 ||
              Math.abs(prev.altitudeFt - altitudeFt) > 100;
            return changed ? { headingDeg, pitchDeg, rollDeg, altitudeFt, altitudeM, altitudeMi } : prev;
          });

          const shouldEnablePhotoTiles =
            mapLayerRef.current === "xml-google-sat" &&
            altitudeFt / 3.28084 < PHOTOREALISTIC_ENABLE_HEIGHT_M;
          if (photoTilesEnabledRef.current !== shouldEnablePhotoTiles) {
            photoTilesEnabledRef.current = shouldEnablePhotoTiles;
            void setPhotorealisticTilesMode(viewer, shouldEnablePhotoTiles);
          }
          spaceLastHudUpdate = now;
        }

        if (now - spaceLastAircraftBboxUpdate > 350) {
          publishAircraftViewportBbox();
          spaceLastAircraftBboxUpdate = now;
        }

        if (spaceConfig.cameraMode === "helicopter") {
          const roll = typeof cam.roll === "number" ? cam.roll : 0;
          if (Math.abs(roll) > 0.0001) {
            const rollNorm = Math.atan2(Math.sin(roll), Math.cos(roll));
            const levelStep = Math.max(-0.03, Math.min(0.03, -rollNorm));
            cam.twistRight(levelStep);
            viewer.scene.requestRender();
          }
        }

        const m = getMotion();
        const hasMotion =
          Math.abs(m.tx) > 0.0005 ||
          Math.abs(m.ty) > 0.0005 ||
          Math.abs(m.tz) > 0.0005 ||
          Math.abs(m.rx) > 0.0005 ||
          Math.abs(m.ry) > 0.0005 ||
          Math.abs(m.rz) > 0.0005;
        if (!hasMotion) return;
        const moveScale = cam.positionCartographic?.height
          ? Math.max(25, cam.positionCartographic.height * 0.6)
          : 3000;
        const moveStep = moveScale * dt * spaceConfig.moveSpeed;
        const rotStep = 1.2 * dt * spaceConfig.rotateSpeed;
        const tiltSign = spaceConfig.invertTilt ? 1 : -1;

        if (spaceConfig.cameraMode === "helicopter") {
          const lateralStep = moveStep * spaceConfig.lateralBoost;
          cam.moveRight(m.tx * lateralStep);
          cam.moveUp(m.ty * moveStep * 1.15);
          cam.moveForward(-m.tz * lateralStep * 0.9);

          const yawInput = m.rz - m.ry * 0.35;
          cam.lookRight(yawInput * rotStep);
          let pitchDelta = tiltSign * m.rx * rotStep * spaceConfig.tiltEffect * 0.85;
          const currentPitch = typeof cam.pitch === "number" ? cam.pitch : null;
          if (currentPitch !== null && Number.isFinite(currentPitch)) {
            const maxPitch = -0.1;
            const minPitch = -Math.PI / 2 + 0.04;
            const targetPitch = Math.max(minPitch, Math.min(maxPitch, currentPitch + pitchDelta));
            pitchDelta = targetPitch - currentPitch;
          }
          cam.lookUp(pitchDelta);
        } else {
          cam.moveRight(m.tx * moveStep);
          cam.moveUp(m.ty * moveStep);
          cam.moveForward(-m.tz * moveStep);
          cam.lookRight(m.rz * rotStep);
          cam.lookUp(tiltSign * m.rx * rotStep * spaceConfig.tiltEffect);
          cam.twistRight(-m.ry * rotStep);
        }

        viewer.scene.requestRender();
      };

      window.addEventListener("spacemouse-motion", onSpaceMotion);
      window.addEventListener("spacemouse-config", onSpaceConfig);
      viewer.scene.preRender.addEventListener(onSpacePreRender);

      return () => {
        window.removeEventListener("spacemouse-motion", onSpaceMotion);
        window.removeEventListener("spacemouse-config", onSpaceConfig);
        try {
          viewer.scene.preRender.removeEventListener(onSpacePreRender);
        } catch {
          // scene may already be destroyed
        }
        document.removeEventListener("keydown", onKey);
        if (aircraftBboxTimer !== null) window.clearTimeout(aircraftBboxTimer);
        if (typeof removeCameraChanged === "function") removeCameraChanged();
        handler.destroy();
        clearTrails();
        viewer.destroy();
        viewerRef.current = null;
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown initialization error";
      setInitError(msg);
    }
  }, []);

  // ── Switch map layer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (viewerRef.current) applyMapLayer(viewerRef.current, mapLayer);
  }, [mapLayer]);

  // ── Toggle photorealistic 3D tiles at runtime ─────────────────────────────
  useEffect(() => {
    if (!viewerRef.current) return;
    const height = viewerRef.current.camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY;
    const enablePhotoTiles = mapLayer === "xml-google-sat" && height < PHOTOREALISTIC_ENABLE_HEIGHT_M;
    photoTilesEnabledRef.current = enablePhotoTiles;
    void setPhotorealisticTilesMode(viewerRef.current, enablePhotoTiles);
  }, [mapLayer]);

  // ── Focus helpers triggered by tracker panel controls ─────────────────────
  useEffect(() => {
    const onFocusSatellite = (ev: Event) => {
      const sat = (ev as CustomEvent<Satellite>).detail;
      const viewer = viewerRef.current;
      if (!viewer || !Cesium || !sat) return;
      const altM = sat.altitude * 1000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(sat.lng, sat.lat, altM + 1_200_000),
        orientation: {
          heading: 0,
          // Look straight down so the focused satellite is centered in view.
          pitch: NADIR_PITCH_RAD,
          roll: 0,
        },
        duration: 1.6,
      });
    };
    window.addEventListener("focus-satellite", onFocusSatellite);
    return () => window.removeEventListener("focus-satellite", onFocusSatellite);
  }, []);

  // ── Fly to active region ───────────────────────────────────────────────────
  useEffect(() => {
    const v = REGION_VIEWS[activeRegion];
    if (!v || !viewerRef.current || !Cesium) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(v.lng, v.lat, v.alt),
      orientation: {
        heading: 0,
        pitch: NADIR_PITCH_RAD,
        roll: 0,
      },
      duration: 2,
    });
  }, [activeRegion]);

  // ── Fly camera to selected event (feed click) ─────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium || !selectedEvent) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(selectedEvent.lng, selectedEvent.lat, 1_200_000),
      orientation: {
        heading: 0,
        pitch: NADIR_PITCH_RAD,
        roll: 0,
      },
      duration: 1.1,
    });
  }, [selectedEvent]);

  function snapNorthUp() {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    const cam = viewer.camera;
    const carto = cam.positionCartographic;
    const destination =
      carto && Number.isFinite(carto.longitude) && Number.isFinite(carto.latitude)
        ? Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, Math.max(1, carto.height))
        : cam.position;
    cam.setView({
      destination,
      orientation: {
        heading: 0,
        pitch: cam.pitch,
        roll: 0,
      },
    });
    viewer.scene.requestRender();
  }

  function resetTiltLevel() {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    const cam = viewer.camera;
    cam.setView({
      orientation: {
        heading: cam.heading,
        pitch: DEFAULT_LEVEL_PITCH_RAD,
        roll: 0,
      },
    });
    viewer.scene.requestRender();
  }

  function resetTiltZero() {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    const cam = viewer.camera;
    cam.setView({
      orientation: {
        heading: cam.heading,
        // Straight down (nadir): 90 degrees downward from horizon.
        // Keep a tiny epsilon from -PI/2 to avoid singularity jitter.
        pitch: -Math.PI / 2 + 0.0001,
        roll: 0,
      },
    });
    viewer.scene.requestRender();
  }

  function flyToDefaultEarthAltitude() {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    const cam = viewer.camera;
    const carto = cam.positionCartographic;
    if (!carto || !Number.isFinite(carto.longitude) || !Number.isFinite(carto.latitude)) return;
    cam.flyTo({
      destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, DEFAULT_EARTH_ALTITUDE_M),
      orientation: {
        heading: 0,
        pitch: NADIR_PITCH_RAD,
        roll: 0,
      },
      duration: 1.1,
    });
  }

  // ── Render events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;

    // Remove old event entities
    entityMap.current.forEach((ent, k) => {
      if (k.startsWith("ev-")) { viewer.entities.remove(ent); entityMap.current.delete(k); }
    });

    const visible = events.filter((ev) => {
      const lookbackH = effectiveEventLookbackHours(ev.source, filters.timeRangeHours);
      const cutoff = Date.now() - lookbackH * 3_600_000;
      const t = new Date(ev.updatedAt).getTime();
      const timeOk = Number.isFinite(t) && t >= cutoff;
      return (
        filters.eventTypes.length > 0 &&
        filters.eventTypes.includes(ev.type) &&
        filters.regions.length > 0 &&
        matchesRegionFilter(ev, filters.regions) &&
        filters.sources.length > 0 &&
        filters.sources.includes(ev.source.toLowerCase() as GlobeSource) &&
        timeOk
      );
    });

    visible.forEach((ev) => {
      // Source tinting: keep ACLED and GDELT visually distinct on-map.
      const color =
        ev.source === "ACLED"
          ? "#f59e0b"
          : ev.source === "GDELT"
            ? "#38bdf8"
            : SEVERITY_COLOR[ev.severity];
      const img = eventBillboard(color, ev.type);
      const size = ev.severity === "critical" ? 28 : ev.severity === "high" ? 24 : 20;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ev.lng, ev.lat),
        billboard: {
          image: img, width: size, height: size,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e3, 1.5, 2e7, 0.5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: ev.title.length > 32 ? ev.title.slice(0, 32) + "…" : ev.title,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 16),
          scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 5e6, 0.3),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
        },
        properties: { eventJSON: JSON.stringify(ev) },
      });
      entityMap.current.set(`ev-${ev.id}`, ent);
    });

    viewer.scene.requestRender();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, filters.eventTypes.join(), filters.regions.join(), filters.sources.join(), filters.timeRangeHours]);

  // ── Render aircraft ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("ac-");
    removeTrailsByType("aircraft");
    if (!filters.trackerTypes.includes("aircraft")) return;

    const visible = aircraft
      .filter(matchesAircraftAffiliation)
      .slice(0, filters.aircraftMaxVisible);

    visible.forEach((a) => {
      const color = a.category === "military" ? "#f87171" : "#93c5fd";
      const icon = aircraftIcon(color, a.heading, a.category === "military");
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(a.lng, a.lat, a.altitude),
        billboard: {
          image: icon, width: 24, height: 24,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.4, 1e7, 0.3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: filters.aircraftShowLabels ? {
          text: a.callsign,
          font: "10px JetBrains Mono, monospace",
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 13),
          scaleByDistance: new Cesium.NearFarScalar(1e3, 0.9, 2e6, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        properties: {
          trackerJSON: JSON.stringify({ kind: "aircraft", data: a }),
        },
      });
      entityMap.current.set(`ac-${a.id}`, ent);
      addTrail(viewer, a.trail, a.altitude, color, "aircraft");
    });
    viewer.scene.requestRender();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aircraft,
    filters.trackerTypes.join(),
    filters.trackerAffiliations.aircraft,
    filters.aircraftMaxVisible,
    filters.aircraftShowLabels,
  ]);

  // ── Render ships ───────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("sh-");
    removeTrailsByType("ships");
    if (!filters.trackerTypes.includes("ships")) return;

    const visible = ships.filter(matchesShipAffiliation).slice(0, filters.shipsMaxVisible);

    visible.forEach((s) => {
      const color = s.category === "military" ? "#f87171" : "#67e8f9";
      const icon = shipIcon(color, s.heading, s.category === "military");
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lng, s.lat, 10),
        billboard: {
          image: icon, width: 22, height: 22,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          // Stay readable at regional presets (e.g. Middle East ~3.5Mm, Americas ~13Mm camera height).
          scaleByDistance: new Cesium.NearFarScalar(8e4, 1.45, 4.5e7, 0.55),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: s.name.length > 16 ? s.name.slice(0, 16) + "…" : s.name,
          font: "10px JetBrains Mono, monospace",
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 12),
          scaleByDistance: new Cesium.NearFarScalar(1e3, 0.85, 1.2e7, 0.35),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          trackerJSON: JSON.stringify({ kind: "ships", data: s }),
        },
      });
      entityMap.current.set(`sh-${s.id}`, ent);
      addTrail(viewer, s.trail, 10, color, "ships");
    });
    viewer.scene.requestRender();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ships, filters.trackerTypes.join(), filters.trackerAffiliations.ships, filters.shipsMaxVisible]);

  // ── Render satellites ──────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("sat-");
    removeTrailsByType("satellites");
    if (!filters.trackerTypes.includes("satellites")) return;

    const selectedSatelliteId =
      selectedTracker?.kind === "satellites" ? selectedTracker.data.id : null;
    const visible = satellites.filter((s) => matchesAffiliation(
      "satellites",
      s.affiliation === "military" || s.category === "military",
    ));

    visible.forEach((s) => {
      const color = SAT_COLORS[s.category];
      const icon = satelliteIcon(color, s.name);
      const altM = s.altitude * 1000;
      const isSelected = s.id === selectedSatelliteId;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lng, s.lat, altM),
        billboard: {
          image: icon, width: isSelected ? 36 : 24, height: isSelected ? 36 : 24,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e5, isSelected ? 2.2 : 1.8, 5e7, isSelected ? 0.55 : 0.35),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: isSelected ? `★ ${s.name}` : s.name,
          font: "9px JetBrains Mono, monospace",
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 10),
          scaleByDistance: new Cesium.NearFarScalar(1e4, isSelected ? 1.0 : 0.6, 1e7, isSelected ? 0.45 : 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          trackerJSON: JSON.stringify({ kind: "satellites", data: s }),
        },
      });
      entityMap.current.set(`sat-${s.id}`, ent);
      if (filters.satelliteShowOrbits) {
        addTrail(viewer, s.trail, altM, color, "satellites");
      }
    });
    viewer.scene.requestRender();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    satellites,
    filters.trackerTypes.join(),
    filters.trackerAffiliations.satellites,
    filters.satelliteShowOrbits,
    selectedTracker?.kind === "satellites" ? selectedTracker.data.id : "",
  ]);

  // ── Hide entities on far side of globe ─────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;

    const onPreRender = () => {
      const camPos = viewer.camera.positionWC;
      const ellipsoid = viewer.scene.globe.ellipsoid;
      const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, camPos);
      entityMap.current.forEach((entity) => {
        try {
          const pos = entity.position?.getValue
            ? entity.position.getValue(Cesium.JulianDate.now())
            : entity.position;
          if (!pos) return;
          entity.show = occluder.isPointVisible(pos);
        } catch {
          entity.show = true;
        }
      });
    };

    viewer.scene.preRender.addEventListener(onPreRender);
    return () => {
      viewer.scene.preRender.removeEventListener(onPreRender);
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function removeEntitiesByPrefix(prefix: string) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    entityMap.current.forEach((ent, k) => {
      if (k.startsWith(prefix)) { viewer.entities.remove(ent); entityMap.current.delete(k); }
    });
  }

  function removeTrailsByType(type: string) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    trailPrims.current = trailPrims.current.filter((p) => {
      if (p.__type === type) { try { viewer.scene.primitives.remove(p); } catch { /* */ } return false; }
      return true;
    });
  }

  function clearTrails() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    trailPrims.current.forEach((p) => { try { viewer.scene.primitives.remove(p); } catch { /* */ } });
    trailPrims.current = [];
  }

  function addTrail(viewer: any, trail: { lat: number; lng: number }[], alt: number, color: string, type: string) {
    if (!trail?.length) return;
    try {
      const c = Cesium.Color.fromCssColorString(color).withAlpha(0.65);
      const positions = trail.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, alt));
      const col = new Cesium.PolylineCollection();
      col.__type = type;
      col.add({ positions, width: 2.2, material: Cesium.Material.fromType("Color", { color: c }) });
      viewer.scene.primitives.add(col);
      trailPrims.current.push(col);
    } catch { /* */ }
  }

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" data-testid="globe" />
      <div className="pointer-events-none absolute left-1/2 top-14 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded border border-[#30363d] bg-[#161b22]/90 px-2 py-1 backdrop-blur">
          <button
            type="button"
            onClick={flyToDefaultEarthAltitude}
            className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-left text-[9px] font-medium leading-tight text-[#c9d1d9] hover:border-[#58a6ff] hover:text-[#58a6ff]"
            title="Reset camera altitude to 45,000,000 ft"
            data-testid="camera-altimeter"
          >
            <div>Alt {Math.round(cameraHud.altitudeFt).toLocaleString()} ft</div>
            <div className="text-[#8b949e]">{Math.round(cameraHud.altitudeM).toLocaleString()} m</div>
            <div className="text-[#8b949e]">{cameraHud.altitudeMi.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi</div>
          </button>
          <button
            onClick={snapNorthUp}
            className="group relative h-7 w-7 rounded border border-[#30363d] bg-[#0d1117] hover:border-[#58a6ff] hover:bg-[#111827]"
            title="Snap map orientation to North-up"
            data-testid="btn-compass-north"
          >
            <div
              className="absolute left-1/2 top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2"
              style={{ transform: `translate(-50%, -50%) rotate(${-cameraHud.headingDeg}deg)` }}
            >
              <div className="absolute left-1/2 top-[5px] h-3 w-[2px] -translate-x-1/2 rounded bg-[#58a6ff]" />
              <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#58a6ff]" />
            </div>
            <span className="absolute -right-1 -top-1 text-[9px] font-semibold text-[#58a6ff]">N</span>
          </button>
          <button
            onClick={resetTiltZero}
            className="h-7 rounded border border-[#30363d] bg-[#0d1117] px-2 text-[10px] font-medium text-[#c9d1d9] hover:border-[#58a6ff] hover:text-[#58a6ff]"
            title="Snap camera tilt straight down (90°)"
            data-testid="btn-compass-tilt-reset"
          >
            Tilt {Math.round(Math.abs(cameraHud.pitchDeg))}°
          </button>
        </div>
      </div>
      {initError && (
        <div className="absolute top-14 left-3 z-50 rounded border border-[#f0883e] bg-[#161b22]/95 px-3 py-2 text-xs text-[#f0883e] max-w-[360px]">
          Globe failed to initialize: {initError}
        </div>
      )}
    </>
  );
}
