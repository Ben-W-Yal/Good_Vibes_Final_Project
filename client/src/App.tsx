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
    setAcledStatus,
    setGdeltStatus,
    setAcledPaging,
    activeRegion, filters,
    aircraftViewportBbox,
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

  async function fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs = 12_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...(init ?? {}), signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
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

  function mapHeadlineType(text?: string): EventType {
    const t = (text || "").toLowerCase();
    if (t.includes("missile")) return "Missile Strike";
    if (t.includes("rocket")) return "Rocket Attack";
    if (t.includes("drone") || t.includes("uav")) return "Drone Strike";
    if (t.includes("airstrike") || t.includes("air strike")) return "Airstrike";
    if (t.includes("bomb") || t.includes("explos")) return "Explosion";
    if (t.includes("clash") || t.includes("battle") || t.includes("ambush") || t.includes("firefight")) return "Ground Clashes";
    if (t.includes("maritime") || t.includes("ship") || t.includes("vessel") || t.includes("naval")) return "Maritime Incident";
    if (t.includes("cyber") || t.includes("ransomware") || t.includes("hack")) return "Cyber";
    if (t.includes("protest") || t.includes("demonstrat")) return "Protest";
    if (t.includes("tariff") || t.includes("sanction") || t.includes("inflation") || t.includes("trade")) return "Economic";
    if (t.includes("law") || t.includes("policy") || t.includes("parliament") || t.includes("senate") || t.includes("election")) {
      return "Political";
    }
    return "Political";
  }

  function conflictFallbackLocation(text: string): { lat: number; lng: number; name: string } | null {
    const t = text.toLowerCase();
    if (/ukrain|kyiv|kharkiv|odesa|donetsk|crimea/.test(t)) {
      return { lat: 49.0, lng: 31.4, name: "Ukraine" };
    }
    if (/russia|moscow|kursk|belgorod/.test(t)) {
      return { lat: 61.52, lng: 105.32, name: "Russia" };
    }
    if (/gaza|rafah|khan younis/.test(t)) {
      return { lat: 31.5, lng: 34.47, name: "Gaza" };
    }
    if (/israel|tel aviv|jerusalem/.test(t)) {
      return { lat: 31.05, lng: 34.85, name: "Israel" };
    }
    if (/iran|tehran/.test(t)) {
      return { lat: 32.43, lng: 53.69, name: "Iran" };
    }
    if (/syria|damascus|aleppo/.test(t)) {
      return { lat: 34.8, lng: 38.99, name: "Syria" };
    }
    if (/lebanon|beirut|hezbollah/.test(t)) {
      return { lat: 33.85, lng: 35.86, name: "Lebanon" };
    }
    if (/yemen|houthi|hodeidah|aden/.test(t)) {
      return { lat: 15.55, lng: 48.52, name: "Yemen" };
    }
    return null;
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
        const jittered = jitterLatLng(entity.id, hit.lat, hit.lng, "place");
        lat = jittered.lat;
        lng = jittered.lng;
        locationLabel = hit.name;
      } else {
        const j = jitterLatLng(entity.id, entity.lat, entity.lon, "region");
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
      type: mapHeadlineType(`${title} ${description}`),
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
    const geo = hit
      ? jitterLatLng(entity.id, hit.lat, hit.lng, "place")
      : jitterLatLng(entity.id, entity.lat, entity.lon, "region");
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

    // Prefer exact placement for GDELT points:
    // - GEO rows are already precise
    // - DOC rows use direct place-hit coordinates when available (no jitter)
    // - DOC rows without place-hit keep server-provided coordinates so feed/map stay in sync
    let lat = entity.lat;
    let lng = entity.lon;
    let finalLocation = locationLabel;
    let finalPlaceName = placeName;
    if (!preciseGeo) {
      const relatedCorpus = relatedArticles.slice(0, 4).map((a) => a.title).join(" ");
      const corpus = `${title} ${description} ${relatedCorpus}`;
      const hit = textGeoLookup(corpus);
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
        finalLocation = hit.name;
        finalPlaceName = hit.name;
      } else {
        // Avoid misleading publisher-country fallback for conflict stories where
        // text contains obvious location hints the simple matcher may miss.
        const fallback = conflictFallbackLocation(corpus);
        if (fallback) {
          lat = fallback.lat;
          lng = fallback.lng;
          finalLocation = fallback.name;
          finalPlaceName = fallback.name;
        }
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

  function mergeEventsById(preferred: GeoEvent[], extras: GeoEvent[]): GeoEvent[] {
    const out = new Map<string, GeoEvent>();
    for (const ev of preferred) out.set(ev.id, ev);
    for (const ev of extras) {
      if (!out.has(ev.id)) out.set(ev.id, ev);
    }
    return Array.from(out.values());
  }

  useEffect(() => {
    let cancelled = false;
    let latestGdeltEvents: GeoEvent[] = [];
    let latestAcledEvents: GeoEvent[] = [];
    const acledHours = filters.timeRangeHours;
    const acledQueryKey = `${activeRegion}|${acledHours}`;

    setAcledPaging({
      queryKey: acledQueryKey,
      nextCursor: null,
      hasMore: false,
      loadingMore: false,
    });

    async function loadVerifiedFeeds() {
      try {
        const shouldPollGdelt = true;
        const shouldPollAcled = true;
        const shouldPollAi = false;
        const shouldPollTheNewsApi = false;
        const liveFrom = new Date(Date.now() - filters.timeRangeHours * 3_600_000).toISOString();
        const feedBase = new URLSearchParams();
        feedBase.set("from", liveFrom);
        feedBase.set("to", new Date().toISOString());

        const newsFeedParams = new URLSearchParams(feedBase);
        newsFeedParams.set("languages", filters.newsLanguages.join(","));

        const loadSatellites = async (): Promise<Satellite[]> => {
          try {
            const satellitesRes = await fetchWithTimeout("/api/trackers/satellites");
            if (!satellitesRes.ok) {
              console.warn("[feeds] satellites HTTP", satellitesRes.status, "— keeping prior TLEs");
              return useStore.getState().satellites;
            }
            return (await satellitesRes.json()) as Satellite[];
          } catch (e) {
            console.warn("[feeds] satellites request failed — keeping prior TLEs", e);
            return useStore.getState().satellites;
          }
        };

        const loadGdeltBatch = async (): Promise<GeoEvent[]> => {
          if (!shouldPollGdelt) return latestGdeltEvents;
          let gdeltEvents: GeoEvent[] = latestGdeltEvents;
          try {
            const gdeltParams = new URLSearchParams(newsFeedParams);
            gdeltParams.set("conflictNews", "1");
            gdeltParams.set("languages", filters.newsLanguages.join(","));
            // Ask for more rows as the user widens the event window.
            const gdeltLimit = Math.min(
              400,
              Math.max(180, Math.round(filters.timeRangeHours * 6)),
            );
            gdeltParams.set("limit", String(gdeltLimit));
            const gdeltRes = await fetchWithTimeout(
              `/api/gdelt/events?${gdeltParams.toString()}`,
              undefined,
              32_000,
            );
            if (gdeltRes.ok) {
              const payload = (await gdeltRes.json()) as { entities?: GlobeEntity[] };
              gdeltEvents = (payload.entities ?? []).map(gdeltEntityToGeoEvent);
              latestGdeltEvents = gdeltEvents;
              setGdeltStatus({
                state: "enabled",
                message:
                  gdeltEvents.length > 0
                    ? `${gdeltEvents.length} events`
                    : "0 events (upstream empty/rate-limited)",
                lastUpdated: new Date().toISOString(),
              });
            } else if (gdeltRes.status === 503) {
              latestGdeltEvents = [];
              gdeltEvents = [];
              setGdeltStatus({
                state: "disabled",
                message: "GDELT disabled by server env",
              });
            } else {
              // Keep last successful GDELT rows on transient upstream failures so
              // the map does not appear to "flip" between sources.
              gdeltEvents = latestGdeltEvents;
              setGdeltStatus({
                state: "error",
                message:
                  latestGdeltEvents.length > 0
                    ? `GDELT failed (${gdeltRes.status}) — showing last ${latestGdeltEvents.length}`
                    : `GDELT failed (${gdeltRes.status})`,
              });
            }
          } catch (_err) {
            gdeltEvents = latestGdeltEvents;
            setGdeltStatus({
              state: "error",
              message:
                latestGdeltEvents.length > 0
                  ? `GDELT request failed — showing last ${latestGdeltEvents.length}`
                  : "GDELT request failed (network/upstream)",
            });
          }
          return gdeltEvents;
        };

        const loadAcledBatch = async (): Promise<GeoEvent[]> => {
          if (!shouldPollAcled) return latestAcledEvents;
          let acledEvents: GeoEvent[] = latestAcledEvents;
          try {
            const acledParams = new URLSearchParams();
            // Pull maximum available ACLED rows regardless age; account tier controls recency.
            acledParams.set("limit", "5000");
            const acledRes = await fetchWithTimeout(
              `/api/acled/events?${acledParams.toString()}`,
              undefined,
              75_000,
            );
            if (acledRes.ok) {
              const payload = (await acledRes.json()) as {
                entities?: GlobeEntity[];
                nextCursor?: string | null;
              };
              const firstPage = (payload.entities ?? []).map(acledEntityToGeoEvent);
              const state = useStore.getState();
              const canReuseExisting = state.acledQueryKey === acledQueryKey;
              const existingAcled = canReuseExisting
                ? state.events.filter((ev) => ev.source === "ACLED")
                : [];
              const merged = mergeEventsById(firstPage, existingAcled);
              const preservedCursor =
                canReuseExisting && existingAcled.length > firstPage.length
                  ? String(existingAcled.length)
                  : (payload.nextCursor ?? null);
              const preservedHasMore =
                canReuseExisting && existingAcled.length > firstPage.length
                  ? state.acledHasMore
                  : Boolean(payload.nextCursor);

              acledEvents = merged;
              latestAcledEvents = merged;
              setAcledStatus({
                state: "enabled",
                message: `${merged.length} events`,
                lastUpdated: new Date().toISOString(),
              });
              setAcledPaging({
                queryKey: acledQueryKey,
                nextCursor: preservedCursor,
                hasMore: preservedHasMore,
                loadingMore: false,
              });
            } else if (acledRes.status === 503) {
              const payload = (await acledRes.json().catch(() => ({}))) as { reason?: string };
              latestAcledEvents = [];
              acledEvents = [];
              setAcledStatus({
                state: "disabled",
                message:
                  payload.reason ??
                  "Set ACLED_ACCESS_KEY + ACLED_EMAIL_ADDRESS (developer API) or ACLED_EMAIL + ACLED_PASSWORD (OAuth) in .env",
              });
              setAcledPaging({
                queryKey: acledQueryKey,
                nextCursor: null,
                hasMore: false,
                loadingMore: false,
              });
            } else {
              const payload = (await acledRes.json().catch(() => ({}))) as { message?: string };
              // Keep last successful ACLED rows on transient failures so both
              // sources remain visible together.
              acledEvents = latestAcledEvents;
              setAcledStatus({
                state: "error",
                message:
                  latestAcledEvents.length > 0
                    ? `${payload.message ?? `ACLED failed (${acledRes.status})`} — showing last ${latestAcledEvents.length}`
                    : (payload.message ?? `ACLED failed (${acledRes.status})`),
              });
            }
          } catch (_err) {
            acledEvents = latestAcledEvents;
            setAcledStatus({
              state: "error",
              message:
                latestAcledEvents.length > 0
                  ? `ACLED request failed — showing last ${latestAcledEvents.length}`
                  : "ACLED request failed (network)",
            });
          }
          return acledEvents;
        };

        const [satellites, gdeltEvents, acledEvents] = await Promise.all([
          loadSatellites(),
          loadGdeltBatch(),
          loadAcledBatch(),
        ]);

        let aiEvents: GeoEvent[] = [];
        if (shouldPollAi) {
          const aiRes = await fetchWithTimeout(`/api/ai/events?${newsFeedParams.toString()}`, undefined, 10_000);
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
          }
        }

        let thenewsEvents: GeoEvent[] = [];
        if (shouldPollTheNewsApi) {
          const thenewsRes = await fetchWithTimeout(
            `/api/thenewsapi/events?${newsFeedParams.toString()}`,
          );
          if (thenewsRes.ok) {
            const payload = (await thenewsRes.json()) as { entities?: GlobeEntity[] };
            thenewsEvents = (payload.entities ?? []).map(thenewsapiEntityToGeoEvent);
          }
        }

        if (cancelled) return;
        setEvents([
          ...gdeltEvents,
          ...acledEvents,
        ]);
        setSatellites(satellites);
      } catch (_err) {
        if (cancelled) return;
        setEvents([]);
        setSatellites([]);
        latestGdeltEvents = [];
        latestAcledEvents = [];
        setAcledStatus({
          state: "error",
          message: "Failed loading one or more feeds",
        });
        setGdeltStatus({
          state: "error",
          message: "Failed loading one or more feeds",
        });
        setAcledPaging({
          queryKey: acledQueryKey,
          nextCursor: null,
          hasMore: false,
          loadingMore: false,
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
    filters.newsLanguages.join(","),
  ]);

  useEffect(() => {
    if (!filters.trackerTypes.includes("aircraft")) {
      setAircraft([]);
      return;
    }

    let cancelled = false;

    async function loadAircraftInView() {
      const params = new URLSearchParams();
      params.set("limit", String(Math.max(12_000, filters.aircraftMaxVisible)));
      if (aircraftViewportBbox) {
        params.set("bbox", aircraftViewportBbox.join(","));
      }

      try {
        const res = await fetchWithTimeout(`/api/trackers/aircraft?${params.toString()}`, undefined, 22_000);
        if (!res.ok) throw new Error(`Aircraft feed failed (${res.status})`);
        const aircraft = await res.json() as Aircraft[];
        if (!cancelled) setAircraft(aircraft);
      } catch {
        // Keep the previous view's aircraft briefly rather than flickering to empty on transient feed errors.
      }
    }

    void loadAircraftInView();
    const timer = window.setInterval(loadAircraftInView, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    [...filters.trackerTypes].sort().join(","),
    aircraftViewportBbox?.join(","),
    filters.aircraftMaxVisible,
  ]);

  useEffect(() => {
    if (!filters.trackerTypes.includes("ships")) {
      setShips([]);
      return;
    }

    let cancelled = false;

    async function loadShipsInView() {
      const params = new URLSearchParams();
      params.set("limit", String(Math.max(12_000, filters.shipsMaxVisible)));
      if (aircraftViewportBbox) {
        params.set("bbox", aircraftViewportBbox.join(","));
      }

      try {
        const res = await fetchWithTimeout(`/api/trackers/ships?${params.toString()}`, undefined, 28_000);
        if (!res.ok) throw new Error(`Ship feed failed (${res.status})`);
        const ships = await res.json() as Ship[];
        if (!cancelled) setShips(ships);
      } catch {
        // Keep previous ships on transient provider errors.
      }
    }

    void loadShipsInView();
    const timer = window.setInterval(loadShipsInView, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    [...filters.trackerTypes].sort().join(","),
    aircraftViewportBbox?.join(","),
    filters.shipsMaxVisible,
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
