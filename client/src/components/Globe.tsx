import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  Cesium, createViewer, applyMapLayer,
  eventBillboard, aircraftIcon, shipIcon, satelliteIcon,
  REGION_VIEWS,
} from "../lib/cesium";
import { SEVERITY_COLOR } from "../data/events";
import { SAT_COLORS, type Aircraft } from "../data/trackers";
import { aircraftInEnabledCocoms } from "../data/cocoms";
import type { GlobeSource } from "../../../src/types/globe";

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<any>(null);
  const entityMap    = useRef<Map<string, any>>(new Map());
  const trailPrims   = useRef<any[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const {
    mapLayer, activeRegion,
    events, aircraft, ships, satellites,
    filters, selectEvent, selectTracker,
  } = useStore();

  const matchesAffiliation = (type: "aircraft" | "ships" | "satellites", isMilitary: boolean) => {
    const mode = filters.trackerAffiliations[type];
    if (mode === "all") return true;
    if (mode === "military") return isMilitary;
    return !isMilitary;
  };

  const ftToM = (ft: number) => ft * 0.3048;

  const passesAircraftFilters = (a: Aircraft): boolean => {
    const mode = filters.aircraftGroundMode;
    if (mode === "ground") {
      if (a.onGround !== true) return false;
    } else if (mode === "airborne") {
      if (a.onGround === true) return false;
    }

    const altLoFt = Math.min(filters.aircraftAltMinFt, filters.aircraftAltMaxFt);
    const altHiFt = Math.max(filters.aircraftAltMinFt, filters.aircraftAltMaxFt);
    const altMinM = ftToM(altLoFt);
    const altMaxM = ftToM(altHiFt);
    if (a.altitude < altMinM || a.altitude > altMaxM) return false;

    const spdLo = Math.min(filters.aircraftSpeedMinKt, filters.aircraftSpeedMaxKt);
    const spdHi = Math.max(filters.aircraftSpeedMinKt, filters.aircraftSpeedMaxKt);
    if (a.speed < spdLo || a.speed > spdHi) return false;

    const cq = filters.aircraftCallsignQuery.trim().toLowerCase();
    if (cq && !a.callsign.toLowerCase().includes(cq)) return false;

    const nq = filters.aircraftCountryQuery.trim().toLowerCase();
    if (nq && !a.country.toLowerCase().includes(nq)) return false;

    const src = filters.aircraftSourceFilter;
    if (src === "opensky" && !a.id.startsWith("os-")) return false;
    if (src === "verified" && a.id.startsWith("os-")) return false;

    if (!aircraftInEnabledCocoms(a.lng, a.lat, filters.aircraftCocoms)) return false;

    return true;
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
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-10, 25, 22_000_000),
        duration: 0,
      });

      // Click handler
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
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

      // Keyboard navigation
      const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const cam = viewer.camera;
        const spd = e.shiftKey ? 500_000 : 100_000;
        switch (e.key) {
          case "w": case "W": cam.moveForward(spd); break;
          case "s": case "S": cam.moveBackward(spd); break;
          case "a": case "A": cam.moveLeft(spd); break;
          case "d": case "D": cam.moveRight(spd); break;
          case "q": case "Q": cam.lookLeft(0.02); break;
          case "e": case "E": cam.lookRight(0.02); break;
          case "r": case "R": cam.moveUp(spd); break;
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

      return () => {
        document.removeEventListener("keydown", onKey);
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

  // ── Fly to active region ───────────────────────────────────────────────────
  useEffect(() => {
    const v = REGION_VIEWS[activeRegion];
    if (!v || !viewerRef.current || !Cesium) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(v.lng, v.lat, v.alt),
      duration: 2,
    });
  }, [activeRegion]);

  // ── Render events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;

    // Remove old event entities
    entityMap.current.forEach((ent, k) => {
      if (k.startsWith("ev-")) { viewer.entities.remove(ent); entityMap.current.delete(k); }
    });

    const cutoff = Date.now() - filters.timeRangeHours * 3_600_000;
    const visible = events.filter((ev) => {
      // Skip articles flagged as non-mappable (e.g. Perigon / GDELT-DOC fallbacks
      // whose coordinates are only the publisher country's centroid).
      if (ev.mappable === false) return false;
      // Honour the user's time range selection for ALL sources. If the user
      // picked "24h" they want the last 24 hours — period. ACLED rows carry the
      // incident date (embargoed ~13 months on the free tier), so they'll only
      // appear when the range is wide enough; that's the intended behaviour.
      const t = new Date(ev.updatedAt).getTime();
      const timeOk = !Number.isFinite(t) || t >= cutoff;
      return (
        filters.categories.includes(ev.category) &&
        filters.severities.includes(ev.severity) &&
        (filters.sources.length === 0 || filters.sources.includes(ev.source.toLowerCase() as GlobeSource)) &&
        timeOk
      );
    });

    visible.forEach((ev) => {
      const color = SEVERITY_COLOR[ev.severity];
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
  }, [events, filters.categories.join(), filters.severities.join(), filters.sources.join(), filters.timeRangeHours]);

  // ── Render aircraft ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("ac-");
    removeTrailsByType("aircraft");
    if (!filters.trackerTypes.includes("aircraft")) return;

    const visible = aircraft
      .filter((a) => matchesAffiliation("aircraft", a.category === "military"))
      .filter(passesAircraftFilters)
      .slice(0, filters.aircraftMaxVisible);

    visible.forEach((a) => {
      const color = a.category === "military" ? "#f87171" : "#93c5fd";
      const icon = aircraftIcon(color, a.heading, a.category === "military");
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(a.lng, a.lat, a.altitude),
        billboard: {
          image: icon, width: 22, height: 22,
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
    filters.aircraftGroundMode,
    filters.aircraftAltMinFt,
    filters.aircraftAltMaxFt,
    filters.aircraftSpeedMinKt,
    filters.aircraftSpeedMaxKt,
    filters.aircraftCallsignQuery,
    filters.aircraftCountryQuery,
    filters.aircraftSourceFilter,
    JSON.stringify(filters.aircraftCocoms),
  ]);

  // ── Render ships ───────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("sh-");
    removeTrailsByType("ships");
    if (!filters.trackerTypes.includes("ships")) return;

    const visible = ships.filter((s) => matchesAffiliation("ships", s.category === "military"));

    visible.forEach((s) => {
      const color = s.category === "military" ? "#f87171" : "#67e8f9";
      const icon = shipIcon(color, s.heading, s.category === "military");
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lng, s.lat, 10),
        billboard: {
          image: icon, width: 20, height: 20,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.3, 1e7, 0.25),
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
          scaleByDistance: new Cesium.NearFarScalar(1e3, 0.8, 1.5e6, 0),
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
  }, [ships, filters.trackerTypes.join(), filters.trackerAffiliations.ships]);

  // ── Render satellites ──────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;
    removeEntitiesByPrefix("sat-");
    removeTrailsByType("satellites");
    if (!filters.trackerTypes.includes("satellites")) return;

    const visible = satellites.filter((s) => matchesAffiliation("satellites", s.category === "military"));

    visible.forEach((s) => {
      const color = SAT_COLORS[s.category];
      const icon = satelliteIcon(color);
      const altM = s.altitude * 1000;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lng, s.lat, altM),
        billboard: {
          image: icon, width: 16, height: 16,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 5e7, 0.3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: s.name,
          font: "9px JetBrains Mono, monospace",
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 10),
          scaleByDistance: new Cesium.NearFarScalar(1e4, 0.6, 1e7, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          trackerJSON: JSON.stringify({ kind: "satellites", data: s }),
        },
      });
      entityMap.current.set(`sat-${s.id}`, ent);
      addTrail(viewer, s.trail, altM, color, "satellites");
    });
    viewer.scene.requestRender();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satellites, filters.trackerTypes.join(), filters.trackerAffiliations.satellites]);

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
      {initError && (
        <div className="absolute top-14 left-3 z-50 rounded border border-[#f0883e] bg-[#161b22]/95 px-3 py-2 text-xs text-[#f0883e] max-w-[360px]">
          Globe failed to initialize: {initError}
        </div>
      )}
    </>
  );
}
