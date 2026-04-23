import { useEffect } from "react";
import { useStore } from "./store";
import type { Category, EventType, GeoEvent, Severity } from "./data/events";
import type { Aircraft, Ship, Satellite } from "./data/trackers";
import type { GlobeEntity } from "../../src/types/globe";
import { Globe } from "./components/Globe";
import { Toolbar } from "./components/Toolbar";
import { EventSidebar } from "./components/EventSidebar";
import { EventDetail } from "./components/EventDetail";
import TrackerPanel from "./components/TrackerPanel";
import BriefingPanel from "./components/BriefingPanel";
import FilterPanel from "./components/FilterPanel";
import TrackerDetail from "./components/TrackerDetail";
import { textGeoLookup, jitterLatLng } from "./lib/textGeo";

export default function App() {
  const {
    setEvents, setAircraft, setShips, setSatellites,
    setLiveuamapStatus,
    setPerigonStatus,
    setAcledStatus,
    activeRegion, filters,
    selectedEvent, selectEvent,
    selectedTracker, selectTracker,
  } = useStore();

  function relativeFromIso(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.max(1, Math.floor(diffMs / 60_000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function aircraftBboxForRegion(region: typeof activeRegion): [number, number, number, number] | null {
    switch (region) {
      case "Africa":
        return [-20, -35, 55, 38];
      case "Asia":
        return [25, -10, 180, 75];
      case "Middle East":
        return [30, 12, 65, 42];
      case "Europe":
        return [-25, 34, 45, 72];
      case "Americas":
        return [-170, -56, -30, 72];
      case "Ukraine":
        return [20, 43, 42, 53];
      default:
        return null;
    }
  }

  function mapLiveCategory(category: GlobeEntity["category"]): Category {
    if (category === "news") return "social";
    return "conflict";
  }

  function mapLiveSeverity(confidence?: number): Severity {
    const c = confidence ?? 0.55;
    if (c >= 0.85) return "critical";
    if (c >= 0.7) return "high";
    if (c >= 0.45) return "medium";
    return "low";
  }

  function mapLiveType(subcategory?: string): EventType {
    const t = (subcategory || "").toLowerCase();
    if (t.includes("missile")) return "Missile Strike";
    if (t.includes("drone")) return "Drone Strike";
    if (t.includes("airstrike")) return "Airstrike";
    if (t.includes("rocket")) return "Rocket Attack";
    if (t.includes("protest")) return "Protest";
    return "Attack";
  }

  function liveEntityToGeoEvent(entity: GlobeEntity): GeoEvent {
    const region = typeof entity.metadata.region === "string" ? entity.metadata.region : "Unknown";
    const sourceUrl = typeof entity.metadata.sourceUrl === "string" ? entity.metadata.sourceUrl : "#";
    const mediaUrl = typeof entity.metadata.mediaUrl === "string" ? entity.metadata.mediaUrl : undefined;
    const title = entity.label || (typeof entity.metadata.originalTitle === "string" ? entity.metadata.originalTitle : "Liveuamap alert");
    const description =
      (typeof entity.metadata.originalText === "string" ? entity.metadata.originalText : undefined) ||
      "Rapid situational-awareness update from Liveuamap.";

    return {
      id: `liveuamap-${entity.id}`,
      title,
      description,
      background: "Liveuamap alert feed. Confirm with additional sources before operational use.",
      lat: entity.lat,
      lng: entity.lon,
      severity: mapLiveSeverity(entity.confidence),
      category: mapLiveCategory(entity.category),
      type: mapLiveType(entity.subcategory),
      region,
      country: region,
      source: "Liveuamap",
      sourceUrl,
      mediaUrl,
      timestamp: relativeFromIso(entity.timestamp),
      updatedAt: entity.timestamp,
      social: {
        positive: 10,
        negative: 70,
        neutral: 20,
        trending: false,
        platforms: [],
      },
    };
  }

  function perigonEntityToGeoEvent(entity: GlobeEntity): GeoEvent {
    const region = typeof entity.metadata.region === "string" ? entity.metadata.region : "Global";
    const sourceUrl = typeof entity.metadata.sourceUrl === "string" ? entity.metadata.sourceUrl : "#";
    const title =
      entity.label ||
      (typeof entity.metadata.originalTitle === "string" ? entity.metadata.originalTitle : "News article");
    const description =
      (typeof entity.metadata.originalText === "string" ? entity.metadata.originalText : undefined) ||
      "Article from the Perigon news index.";
    const approxGeo =
      entity.metadata &&
      typeof entity.metadata === "object" &&
      (entity.metadata as { approximateGeo?: boolean }).approximateGeo === true;
    const severity: Severity = approxGeo ? "medium" : mapLiveSeverity(entity.confidence);

    // When Perigon only gave us the publisher country centroid, try to find a
    // more accurate location from the article title + description. A Jordanian
    // outlet writing about Ukraine should end up over Ukraine, not Jordan.
    let lat = entity.lat;
    let lng = entity.lon;
    let locationLabel = region;
    if (approxGeo) {
      const hit = textGeoLookup(`${title} ${description}`);
      if (hit) {
        const jittered = jitterLatLng(entity.id, hit.lat, hit.lng);
        lat = jittered.lat;
        lng = jittered.lng;
        locationLabel = hit.name;
      } else {
        const j = jitterLatLng(entity.id, entity.lat, entity.lon);
        lat = j.lat;
        lng = j.lng;
      }
    }

    return {
      id: `perigon-${entity.id}`,
      title,
      description,
      background: approxGeo
        ? "Perigon headline. Location inferred from article text — verify with original reporting before operational use."
        : "Headline and metadata from Perigon. Verify details with original publishers before operational use.",
      lat,
      lng,
      severity,
      category: mapLiveCategory(entity.category),
      type: "Political",
      region: locationLabel,
      country: locationLabel,
      source: "Perigon",
      sourceUrl,
      timestamp: relativeFromIso(entity.timestamp),
      updatedAt: entity.timestamp,
      mappable: true,
      social: {
        positive: 20,
        negative: 10,
        neutral: 70,
        trending: false,
        platforms: [],
      },
    };
  }

  function thenewsapiEntityToGeoEvent(entity: GlobeEntity): GeoEvent {
    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const region = typeof meta.region === "string" ? meta.region : "Global";
    const sourceUrl = typeof meta.sourceUrl === "string" ? meta.sourceUrl : "#";
    const sourceName = typeof meta.sourceName === "string" ? meta.sourceName : "thenewsapi";
    const title =
      entity.label ||
      (typeof meta.originalTitle === "string" ? meta.originalTitle : "TheNewsAPI article");
    const description =
      (typeof meta.originalText === "string" ? meta.originalText : undefined) ||
      "Article from TheNewsAPI.";

    const hit = textGeoLookup(`${title} ${description}`);
    const geo = hit ? jitterLatLng(entity.id, hit.lat, hit.lng) : jitterLatLng(entity.id, entity.lat, entity.lon);
    const locationLabel = hit?.name ?? region;

    return {
      id: `thenewsapi-${entity.id}`,
      title,
      description,
      background:
        "Article from TheNewsAPI. Coordinates are inferred from article text or locale and should be verified before operational use.",
      lat: geo.lat,
      lng: geo.lng,
      severity: mapLiveSeverity(entity.confidence),
      category: mapLiveCategory(entity.category),
      type: "Political",
      region: locationLabel,
      country: locationLabel,
      source: "TheNewsAPI",
      sourceUrl,
      timestamp: relativeFromIso(entity.timestamp),
      updatedAt: entity.timestamp,
      mappable: true,
      social: {
        positive: 20,
        negative: 15,
        neutral: 65,
        trending: false,
        platforms: [{ name: sourceName, posts: [] }],
      },
    };
  }

  function mapAcledType(subcategory?: string): EventType {
    const t = (subcategory || "").toLowerCase();
    if (t.includes("air") || t.includes("airstrike")) return "Airstrike";
    if (t.includes("protest")) return "Protest";
    if (t.includes("bomb") || t.includes("explos")) return "Explosion";
    if (t.includes("clash") || t.includes("battle") || t.includes("armed")) return "Ground Clashes";
    return mapLiveType(subcategory);
  }

  function acledEntityToGeoEvent(entity: GlobeEntity): GeoEvent {
    const meta = entity.metadata as Record<string, unknown>;
    const notes = typeof meta.notes === "string" ? meta.notes : "";
    const country = typeof meta.country === "string" ? meta.country : "Unknown";
    const regionLabel = typeof meta.region === "string" ? meta.region : country;
    const sourceUrl =
      typeof meta.sourceUrl === "string" && /^https?:\/\//.test(meta.sourceUrl)
        ? meta.sourceUrl
        : "https://acleddata.com/";

    return {
      id: `acled-${entity.id}`,
      title: entity.label || "ACLED event",
      description: notes || "Conflict event from the ACLED dataset.",
      background:
        "Data from ACLED (Armed Conflict Location & Event Data Project). Follow ACLED terms of use for reuse and attribution.",
      lat: entity.lat,
      lng: entity.lon,
      severity: mapLiveSeverity(entity.confidence),
      category: "conflict",
      type: mapAcledType(entity.subcategory),
      region: regionLabel,
      country,
      source: "ACLED",
      sourceUrl,
      timestamp: relativeFromIso(entity.timestamp),
      updatedAt: entity.timestamp,
      social: {
        positive: 5,
        negative: 40,
        neutral: 55,
        trending: false,
        platforms: [],
      },
    };
  }

  function gdeltEntityToGeoEvent(entity: GlobeEntity): GeoEvent {
    const meta = entity.metadata as Record<string, unknown>;
    const title =
      entity.label ||
      (typeof meta.originalTitle === "string" ? meta.originalTitle : "GDELT article");
    const sourceUrl = typeof meta.sourceUrl === "string" ? meta.sourceUrl : "#";
    const preciseGeo = meta.preciseGeo === true;
    const placeName =
      typeof meta.placeName === "string" ? meta.placeName : undefined;
    const sc = typeof meta.sourceCountry === "string" ? meta.sourceCountry : undefined;
    // Prefer the GEO endpoint's location name (e.g. "Kyiv, Ukraine") over the
    // publisher country. Fall back to the country when GEO is unavailable.
    const locationLabel = placeName || sc || "Global";
    const articlesRaw = Array.isArray(meta.articles) ? meta.articles : [];
    const relatedArticles = articlesRaw
      .filter((a): a is { title: string; url: string; domain?: string; date?: string } =>
        typeof a === "object" && a !== null && typeof (a as { url?: unknown }).url === "string",
      )
      .map((a) => ({
        title: a.title || a.url,
        url: a.url,
        domain: a.domain,
        date: a.date,
      }));

    const articleCount =
      typeof meta.articleCount === "number"
        ? meta.articleCount
        : relatedArticles.length;
    const description = preciseGeo
      ? `${articleCount} article${articleCount === 1 ? "" : "s"} ${
          articleCount === 1 ? "mentions" : "mention"
        } ${placeName ?? "this location"} in the last 24 hours.`
      : (typeof meta.originalText === "string" ? meta.originalText : undefined) ||
        "Article from the GDELT DOC index (location inferred from article text).";
    const background = preciseGeo
      ? "GDELT GEO 2.0 API. Coordinates correspond to the location mentioned in the matching articles."
      : "GDELT DOC API. Location inferred from article text; verify with original reporting.";

    // GDELT DOC gives us only a publisher country centroid. Scan the headline
    // for a mentioned country or city so a "Russo-Ukraine" article doesn't
    // land over the outlet's home country.
    let lat = entity.lat;
    let lng = entity.lon;
    let finalLocation = locationLabel;
    let finalPlaceName = placeName;
    if (!preciseGeo) {
      const hit = textGeoLookup(title);
      if (hit) {
        const jittered = jitterLatLng(entity.id, hit.lat, hit.lng);
        lat = jittered.lat;
        lng = jittered.lng;
        finalLocation = hit.name;
        finalPlaceName = hit.name;
      } else {
        const j = jitterLatLng(entity.id, entity.lat, entity.lon);
        lat = j.lat;
        lng = j.lng;
      }
    }

    return {
      id: `gdelt-${entity.id}`,
      title,
      description,
      background,
      lat,
      lng,
      severity: mapLiveSeverity(entity.confidence),
      category: mapLiveCategory(entity.category),
      type: "Political",
      region: finalLocation,
      country: finalLocation,
      source: "GDELT",
      sourceUrl,
      timestamp: relativeFromIso(entity.timestamp),
      updatedAt: entity.timestamp,
      placeName: finalPlaceName,
      relatedArticles,
      thumbnail:
        typeof meta.socialImage === "string" && meta.socialImage.startsWith("http")
          ? meta.socialImage
          : undefined,
      mappable: true,
      social: {
        positive: 12,
        negative: 18,
        neutral: 70,
        trending: false,
        platforms: [],
      },
    };
  }

  useEffect(() => {
    let cancelled = false;
    let latestLiveEvents: GeoEvent[] = [];
    let latestPerigonEvents: GeoEvent[] = [];
    let latestGdeltEvents: GeoEvent[] = [];
    let latestAcledEvents: GeoEvent[] = [];
    let latestAiEvents: GeoEvent[] = [];
    let latestThenewsEvents: GeoEvent[] = [];

    async function loadVerifiedFeeds() {
      try {
        const shouldPollLiveuamap = true;
        const shouldPollPerigon = true;
        const shouldPollGdelt = true;
        const shouldPollAcled = true;
        const liveFrom = new Date(Date.now() - filters.timeRangeHours * 3_600_000).toISOString();
        const feedBase = new URLSearchParams();
        feedBase.set("from", liveFrom);
        feedBase.set("to", new Date().toISOString());

        const liveParams = new URLSearchParams(feedBase);
        liveParams.set("limit", "100");

        const newsFeedParams = new URLSearchParams(feedBase);
        newsFeedParams.set("languages", filters.newsLanguages.join(","));

        const aircraftParams = new URLSearchParams();
        const aircraftFetchLimit = Math.min(
          2000,
          Math.max(filters.aircraftMaxVisible * 6, 800),
        );
        aircraftParams.set("limit", String(aircraftFetchLimit));
        const aircraftBbox = aircraftBboxForRegion(activeRegion);
        if (aircraftBbox) {
          aircraftParams.set("bbox", aircraftBbox.join(","));
        }

        const [eventsRes, aircraftRes, shipsRes, satellitesRes] = await Promise.all([
          fetch("/api/events"),
          fetch(`/api/trackers/aircraft?${aircraftParams.toString()}`),
          fetch("/api/trackers/ships"),
          fetch("/api/trackers/satellites"),
        ]);

        if (!eventsRes.ok || !aircraftRes.ok || !shipsRes.ok || !satellitesRes.ok) {
          throw new Error("One or more verified feeds failed");
        }

        const [events, aircraft, ships, satellites] = await Promise.all([
          eventsRes.json() as Promise<GeoEvent[]>,
          aircraftRes.json() as Promise<Aircraft[]>,
          shipsRes.json() as Promise<Ship[]>,
          satellitesRes.json() as Promise<Satellite[]>,
        ]);

        let liveEvents: GeoEvent[] = latestLiveEvents;
        if (shouldPollLiveuamap) {
          try {
            const liveuamapRes = await fetch(`/api/liveuamap/events?${liveParams.toString()}`);
            if (liveuamapRes.ok) {
              const payload = (await liveuamapRes.json()) as { entities?: GlobeEntity[] };
              liveEvents = (payload.entities ?? []).map(liveEntityToGeoEvent);
              latestLiveEvents = liveEvents;
              setLiveuamapStatus({
                state: "enabled",
                message: `Liveuamap connected (${liveEvents.length} events)`,
                lastUpdated: new Date().toISOString(),
              });
            } else if (liveuamapRes.status === 503) {
              const payload = (await liveuamapRes.json()) as { reason?: string };
              setLiveuamapStatus({
                state: "disabled",
                message: payload.reason ?? "Liveuamap disabled",
              });
            } else {
              setLiveuamapStatus({
                state: "error",
                message: `Liveuamap request failed (${liveuamapRes.status})`,
              });
            }
          } catch (_err) {
            setLiveuamapStatus({
              state: "error",
              message: "Liveuamap request failed (network/error)",
            });
          }
        }

        let perigonEvents: GeoEvent[] = latestPerigonEvents;
        if (shouldPollPerigon) {
          try {
            const perigonRes = await fetch(`/api/perigon/events?${newsFeedParams.toString()}`);
            if (perigonRes.ok) {
              const payload = (await perigonRes.json()) as { entities?: GlobeEntity[] };
              perigonEvents = (payload.entities ?? []).map(perigonEntityToGeoEvent);
              latestPerigonEvents = perigonEvents;
              setPerigonStatus({
                state: "enabled",
                message: `Perigon: ${perigonEvents.length} articles`,
                lastUpdated: new Date().toISOString(),
              });
            } else if (perigonRes.status === 503) {
              const payload = (await perigonRes.json().catch(() => ({}))) as { reason?: string };
              latestPerigonEvents = [];
              perigonEvents = [];
              setPerigonStatus({
                state: "disabled",
                message: payload.reason ?? "Add PERIGON_API_KEY to .env and restart the server",
              });
            } else {
              const payload = (await perigonRes.json().catch(() => ({}))) as { message?: string };
              latestPerigonEvents = [];
              perigonEvents = [];
              setPerigonStatus({
                state: "error",
                message: payload.message ?? `Perigon failed (${perigonRes.status})`,
              });
            }
          } catch (_err) {
            latestPerigonEvents = [];
            perigonEvents = [];
            setPerigonStatus({
              state: "error",
              message: "Perigon request failed (network)",
            });
          }
        }

        let gdeltEvents: GeoEvent[] = latestGdeltEvents;
        if (shouldPollGdelt) {
          try {
            const gdeltParams = new URLSearchParams(newsFeedParams);
            gdeltParams.delete("keyword");
            gdeltParams.set("limit", "80");
            const gdeltRes = await fetch(`/api/gdelt/events?${gdeltParams.toString()}`);
            if (gdeltRes.ok) {
              const payload = (await gdeltRes.json()) as { entities?: GlobeEntity[] };
              gdeltEvents = (payload.entities ?? []).map(gdeltEntityToGeoEvent);
              latestGdeltEvents = gdeltEvents;
            } else if (gdeltRes.status === 503) {
              latestGdeltEvents = [];
              gdeltEvents = [];
            } else {
              latestGdeltEvents = [];
              gdeltEvents = [];
            }
          } catch (_err) {
            latestGdeltEvents = [];
            gdeltEvents = [];
          }
        }

        let acledEvents: GeoEvent[] = latestAcledEvents;
        if (shouldPollAcled) {
          try {
            const acledParams = new URLSearchParams(feedBase);
            acledParams.delete("keyword");
            acledParams.set("limit", "120");
            const acledRes = await fetch(`/api/acled/events?${acledParams.toString()}`);
            if (acledRes.ok) {
              const payload = (await acledRes.json()) as { entities?: GlobeEntity[] };
              acledEvents = (payload.entities ?? []).map(acledEntityToGeoEvent);
              latestAcledEvents = acledEvents;
              setAcledStatus({
                state: "enabled",
                message: `ACLED: ${acledEvents.length} events`,
                lastUpdated: new Date().toISOString(),
              });
            } else if (acledRes.status === 503) {
              const payload = (await acledRes.json().catch(() => ({}))) as { reason?: string };
              latestAcledEvents = [];
              acledEvents = [];
              setAcledStatus({
                state: "disabled",
                message: payload.reason ?? "Set ACLED_EMAIL and ACLED_PASSWORD in .env",
              });
            } else {
              const payload = (await acledRes.json().catch(() => ({}))) as { message?: string };
              latestAcledEvents = [];
              acledEvents = [];
              setAcledStatus({
                state: "error",
                message: payload.message ?? `ACLED failed (${acledRes.status})`,
              });
            }
          } catch (_err) {
            latestAcledEvents = [];
            acledEvents = [];
            setAcledStatus({
              state: "error",
              message: "ACLED request failed (network)",
            });
          }
        }

        let aiEvents: GeoEvent[] = latestAiEvents;
        try {
          const aiRes = await fetch(`/api/ai/events?${newsFeedParams.toString()}`);
          if (aiRes.ok) {
            const payload = (await aiRes.json()) as { entities?: GlobeEntity[] };
            aiEvents = (payload.entities ?? []).map((entity) => {
              const meta = (entity.metadata ?? {}) as Record<string, unknown>;
              const title =
                entity.label ||
                (typeof meta.originalTitle === "string" ? meta.originalTitle : "AI OSINT event");
              const description =
                (typeof meta.originalText === "string" ? meta.originalText : undefined) ||
                "AI-discovered web event. Verify against cited sources.";
              const sourceUrl = typeof meta.sourceUrl === "string" ? meta.sourceUrl : "#";
              return {
                id: `ai-${entity.id}`,
                title,
                description,
                background:
                  "Generated by Gemini web research over recent reporting. Validate details against cited sources.",
                lat: entity.lat,
                lng: entity.lon,
                severity: mapLiveSeverity(entity.confidence),
                category: "social",
                type: "Political",
                region: typeof meta.region === "string" ? meta.region : "Global",
                country: typeof meta.country === "string" ? meta.country : "Global",
                source: "AI",
                sourceUrl,
                timestamp: relativeFromIso(entity.timestamp),
                updatedAt: entity.timestamp,
                mappable: true,
                social: {
                  positive: 15,
                  negative: 20,
                  neutral: 65,
                  trending: false,
                  platforms: [],
                },
              } satisfies GeoEvent;
            });
            latestAiEvents = aiEvents;
          } else {
            aiEvents = [];
            latestAiEvents = [];
          }
        } catch (_err) {
          aiEvents = [];
          latestAiEvents = [];
        }

        let thenewsEvents: GeoEvent[] = latestThenewsEvents;
        try {
          const thenewsRes = await fetch(`/api/thenewsapi/events?${newsFeedParams.toString()}`);
          if (thenewsRes.ok) {
            const payload = (await thenewsRes.json()) as { entities?: GlobeEntity[] };
            thenewsEvents = (payload.entities ?? []).map(thenewsapiEntityToGeoEvent);
            latestThenewsEvents = thenewsEvents;
          } else {
            thenewsEvents = [];
            latestThenewsEvents = [];
          }
        } catch (_err) {
          thenewsEvents = [];
          latestThenewsEvents = [];
        }

        if (cancelled) return;
        setEvents([
          ...aiEvents,
          ...thenewsEvents,
          ...liveEvents,
          ...perigonEvents,
          ...gdeltEvents,
          ...acledEvents,
          ...events,
        ]);
        setAircraft(aircraft);
        setShips(ships);
        setSatellites(satellites);
      } catch (_err) {
        if (cancelled) return;
        setEvents([]);
        setAircraft([]);
        setShips([]);
        setSatellites([]);
        latestLiveEvents = [];
        latestPerigonEvents = [];
        latestGdeltEvents = [];
        latestAcledEvents = [];
        latestAiEvents = [];
        latestThenewsEvents = [];
        setLiveuamapStatus({
          state: "error",
          message: "Failed loading one or more feeds",
        });
        setPerigonStatus({
          state: "error",
          message: "Failed loading one or more feeds",
        });
        setAcledStatus({
          state: "error",
          message: "Failed loading one or more feeds",
        });
      }
    }

    loadVerifiedFeeds();
    const timer = window.setInterval(loadVerifiedFeeds, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeRegion,
    filters.timeRangeHours,
    filters.aircraftMaxVisible,
    filters.newsLanguages.join(","),
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0d1117]">
      {/* Full-screen 3D Globe */}
      <Globe />

      {/* Top toolbar (LiveUAMap-style) */}
      <Toolbar />

      {/* Right sidebar — event feed */}
      <EventSidebar />

      {/* Event detail panel (slides in from right, replaces sidebar) */}
      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => selectEvent(null)} />}
      {!selectedEvent && selectedTracker && (
        <TrackerDetail tracker={selectedTracker} onClose={() => selectTracker(null)} />
      )}

      {/* Tracker control panel (bottom sheet) */}
      <TrackerPanel />

      {/* Filter panel */}
      <FilterPanel />

      {/* Presidential Daily Brief modal */}
      <BriefingPanel />
    </div>
  );
}
