import { useEffect, useState } from "react";
import { useStore } from "../store";
import { getIconClass, SEVERITY_COLOR, type GeoEvent } from "../data/events";
import type { GlobeEntity, GlobeSource } from "../../../src/types/globe";
import { conflictVisualKindFromType } from "../lib/eventVisuals";
import { effectiveEventLookbackHours, matchesRegionFilter } from "../lib/eventFilters";

type FeedTab = "all" | "high-priority" | "conflict" | "strategic" | "watchlist";
const STRATEGIC_TYPES = new Set([
  "Political",
  "Economic",
  "Legislation",
  "Policy",
  "Military Deployment",
  "Military Operation",
  "Deployment",
  "Training",
  "Cyber",
  "Missile Test",
  "Military Exercise",
  "Maritime Incident",
]);

function formatAbsolute(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

function relativeFromIso(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function mapLiveSeverity(confidence?: number) {
  const c = confidence ?? 0.55;
  if (c >= 0.85) return "critical" as const;
  if (c >= 0.7) return "high" as const;
  if (c >= 0.45) return "medium" as const;
  return "low" as const;
}

function mapAcledType(subcategory?: string) {
  const t = (subcategory || "").toLowerCase();
  if (t.includes("air") || t.includes("airstrike")) return "Airstrike" as const;
  if (t.includes("protest")) return "Protest" as const;
  if (t.includes("bomb") || t.includes("explos")) return "Explosion" as const;
  if (t.includes("clash") || t.includes("battle") || t.includes("armed")) return "Ground Clashes" as const;
  if (t.includes("missile")) return "Missile Strike" as const;
  if (t.includes("drone")) return "Drone Strike" as const;
  if (t.includes("rocket")) return "Rocket Attack" as const;
  return "Attack" as const;
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

function mergeEventsById(existing: GeoEvent[], incoming: GeoEvent[]): GeoEvent[] {
  const out = new Map<string, GeoEvent>();
  for (const ev of existing) out.set(ev.id, ev);
  for (const ev of incoming) {
    if (!out.has(ev.id)) out.set(ev.id, ev);
  }
  return Array.from(out.values());
}

function EventCard({
  event,
  onClick,
  watchlisted,
  onToggleWatchlist,
}: {
  event: GeoEvent;
  onClick: () => void;
  watchlisted: boolean;
  onToggleWatchlist: () => void;
}) {
  const color = SEVERITY_COLOR[event.severity];
  const iconClass = getIconClass(event.type);
  const absolute = formatAbsolute(event.updatedAt);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-3 border-b border-[#21262d] hover:bg-[#1c2333] transition-colors group"
      data-testid={`event-card-${event.id}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${iconClass}`}>
          <EventTypeIcon type={event.type} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="text-[10px] text-[#8b949e]"
              title={new Date(event.updatedAt).toLocaleString()}
            >
              {event.timestamp}
              {absolute ? ` · ${absolute}` : ""}
            </span>
            <span className="text-[10px] text-[#6e7681]">·</span>
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] text-[#1f6feb] hover:text-[#388bfd] flex items-center gap-0.5"
            >
              {event.source}
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                <path d="M1.5 6.5L6.5 1.5M6.5 1.5H3M6.5 1.5V5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </a>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleWatchlist();
              }}
              className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${
                watchlisted
                  ? "text-[#f2cc60] border-[#f2cc6066] bg-[#f2cc6022]"
                  : "text-[#8b949e] border-[#30363d] bg-[#0d1117]"
              }`}
              title={watchlisted ? "Remove from watchlist" : "Add to watchlist"}
            >
              ★
            </button>
          </div>

          <p className="text-[12px] text-[#e6edf3] leading-tight font-medium group-hover:text-white transition-colors">
            {event.title}
          </p>

          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
              style={{ color, background: `${color}18`, border: `1px solid ${color}35` }}
            >
              {event.type}
            </span>
            <span className="text-[10px] text-[#6e7681]">{event.country}</span>
            {event.source.toLowerCase() === "liveuamap" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-[#f0883e55] bg-[#f0883e22] text-[#f0883e]">
                FAST ALERT
              </span>
            )}
            {event.mediaUrl && (
              <span className="text-[9px] text-[#d29922] flex items-center gap-0.5">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M1 1.5L7 4 1 6.5V1.5z"/>
                </svg>
                Media
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function EventTypeIcon({ type }: { type: string }) {
  const kind = conflictVisualKindFromType(type);
  if (kind === "drone") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="3" cy="3" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="9" cy="3" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="3" cy="9" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="9" cy="9" r="1.5" stroke="white" strokeWidth="1"/>
      <rect x="4.5" y="4.5" width="3" height="3" rx="0.6" fill="white"/>
    </svg>;
  }
  if (kind === "explosion") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="5.5" cy="7" r="3" fill="white"/>
      <path d="M8.3 3.2L10.5 1" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M8 4L9.5 5.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>;
  }
  if (kind === "ground") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1.5 7.5L7.8 5.2L8.8 6.2L11 5.6L9.4 4L8 2.5L7.4 4.7L6.4 5.7L1.5 7.5Z" fill="white"/>
    </svg>;
  }
  if (kind === "missile") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L7.5 7 L6 6 L4.5 7 Z" fill="white"/>
      <path d="M2 7 L10 7 L9 8 L3 8 Z" fill="white" opacity="0.7"/>
    </svg>;
  }
  if (kind === "airstrike") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L7 6 L6 5.5 L5 6 Z" fill="white"/>
      <path d="M1 5.5 L6 7 L11 5.5 L10.5 6.5 L6 5.5 L1.5 6.5 Z" fill="white" opacity="0.7"/>
    </svg>;
  }
  if (kind === "maritime") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <ellipse cx="6" cy="7" rx="3.5" ry="4" fill="none" stroke="white" strokeWidth="1.2"/>
      <path d="M6 2 L7.5 5 L4.5 5 Z" fill="white"/>
    </svg>;
  }
  if (kind === "protest") {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="4" r="2" fill="white"/>
      <rect x="4" y="7" width="4" height="4" rx="1" fill="white"/>
    </svg>;
  }
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="3.5" fill="white" opacity="0.9"/>
  </svg>;
}

function sourceStatusColor(state: "idle" | "enabled" | "disabled" | "error"): string {
  if (state === "enabled") return "#3fb950";
  if (state === "disabled") return "#d29922";
  if (state === "error") return "#f85149";
  return "#6e7681";
}

export function EventSidebar() {
  const {
    sidebarOpen,
    events,
    filters,
    selectEvent,
    activeRegion,
    setEvents,
    acledStatus,
    gdeltStatus,
    acledNextCursor,
    acledHasMore,
    acledLoadingMore,
    acledQueryKey,
    setAcledPaging,
    watchlistEventIds,
    toggleWatchlistEvent,
  } = useStore();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FeedTab>("all");
  const [acledDebug, setAcledDebug] = useState<string>("");

  const acledRows = events.filter((ev) => ev.source === "ACLED");
  const newestAcledAgeDays = (() => {
    const newestTs = acledRows.reduce((max, ev) => {
      const t = new Date(ev.updatedAt).getTime();
      return Number.isFinite(t) ? Math.max(max, t) : max;
    }, -Infinity);
    if (!Number.isFinite(newestTs) || newestTs < 0) return null;
    return Math.floor((Date.now() - newestTs) / 86_400_000);
  })();
  const acledHistoricalOnly =
    acledStatus.state === "enabled" &&
    acledRows.length > 0 &&
    newestAcledAgeDays !== null &&
    newestAcledAgeDays > 300;

  useEffect(() => {
    let cancelled = false;
    async function loadAcledDebug() {
      try {
        const r = await fetch("/api/acled/debug");
        if (!r.ok) return;
        const j = (await r.json()) as { message?: string; embargoDate?: string | null };
        if (cancelled) return;
        const msg = j.embargoDate
          ? `ACLED recency cutoff: ${j.embargoDate}`
          : (j.message ?? "");
        setAcledDebug(msg);
      } catch {
        // ignore debug fetch issues
      }
    }
    void loadAcledDebug();
    const t = window.setInterval(loadAcledDebug, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (!sidebarOpen) return null;

  async function loadMoreAcled() {
    if (!acledHasMore || !acledNextCursor || acledLoadingMore) return;

    const acledHours = filters.timeRangeHours;
    const currentKey = `${activeRegion}|${acledHours}`;
    if (acledQueryKey && acledQueryKey !== currentKey) return;

    setAcledPaging({ loadingMore: true });
    try {
      const params = new URLSearchParams();
      // Keep paged ACLED loading unrestricted by time to maximize historical coverage.
      params.set("limit", "5000");
      params.set("cursor", acledNextCursor);

      const acledRes = await fetch(`/api/acled/events?${params.toString()}`);
      if (!acledRes.ok) {
        throw new Error(`ACLED load-more failed (${acledRes.status})`);
      }

      const payload = (await acledRes.json()) as {
        entities?: GlobeEntity[];
        nextCursor?: string | null;
      };
      const incoming = (payload.entities ?? []).map(acledEntityToGeoEvent);
      const state = useStore.getState();
      const nonAcled = state.events.filter((ev) => ev.source !== "ACLED");
      const existingAcled = state.events.filter((ev) => ev.source === "ACLED");
      const mergedAcled = mergeEventsById(existingAcled, incoming);
      setEvents([...nonAcled, ...mergedAcled]);
      setAcledPaging({
        queryKey: currentKey,
        nextCursor: payload.nextCursor ?? null,
        hasMore: Boolean(payload.nextCursor),
        loadingMore: false,
      });
    } catch {
      setAcledPaging({ loadingMore: false });
    }
  }

  const baseFiltered = events.filter((ev) => {
      const lookbackH = effectiveEventLookbackHours(ev.source, filters.timeRangeHours);
      const cutoffMs = Date.now() - lookbackH * 3_600_000;
      const t = new Date(ev.updatedAt).getTime();
      if (!Number.isFinite(t) || t < cutoffMs) return false;
      if (filters.eventTypes.length === 0 || !filters.eventTypes.includes(ev.type)) return false;
      if (filters.regions.length === 0 || !matchesRegionFilter(ev, filters.regions)) return false;
      if (filters.sources.length === 0 || !filters.sources.includes(ev.source.toLowerCase() as GlobeSource))
        return false;
      return true;
    });

  const tabFiltered = baseFiltered.filter((ev) => {
    switch (activeTab) {
      case "all":
        return true;
      case "high-priority":
        return ev.severity === "critical" || ev.severity === "high";
      case "conflict":
        return ev.category === "conflict";
      case "strategic":
        return STRATEGIC_TYPES.has(ev.type);
      case "watchlist":
        return watchlistEventIds.includes(ev.id);
    }
  });

  const filtered = tabFiltered
    .filter((ev) => {
      if (
        search &&
        !ev.title.toLowerCase().includes(search.toLowerCase()) &&
        !ev.country.toLowerCase().includes(search.toLowerCase()) &&
        !ev.region.toLowerCase().includes(search.toLowerCase()) &&
        !ev.source.toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    // Most recent first. Items with invalid timestamps sink to the bottom.
    .sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      const va = Number.isFinite(ta) ? ta : -Infinity;
      const vb = Number.isFinite(tb) ? tb : -Infinity;
      return vb - va;
    });

  const tabs: Array<{ key: FeedTab; label: string; count: number }> = [
    { key: "all", label: "All", count: baseFiltered.length },
    {
      key: "high-priority",
      label: "High Priority",
      count: baseFiltered.filter((e) => e.severity === "critical" || e.severity === "high").length,
    },
    { key: "conflict", label: "Conflict", count: baseFiltered.filter((e) => e.category === "conflict").length },
    { key: "strategic", label: "Strategic", count: baseFiltered.filter((e) => STRATEGIC_TYPES.has(e.type)).length },
    { key: "watchlist", label: "Watchlist", count: baseFiltered.filter((e) => watchlistEventIds.includes(e.id)).length },
  ];

  return (
    <div
      className="absolute top-12 right-0 bottom-0 w-[340px] z-20 flex flex-col"
      style={{ background: "rgba(13,17,23,0.97)", borderLeft: "1px solid #30363d" }}
    >
      {/* Sidebar header */}
      <div className="px-3 pt-3 pb-2 border-b border-[#21262d]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-[#e6edf3]">Event Feed</h2>
            <p className="text-[10px] text-[#8b949e]">
              Updated {new Date().toLocaleTimeString()} · {filtered.length} events
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px]">
              <span style={{ color: sourceStatusColor(acledStatus.state) }}>
                ACLED: {acledStatus.message}
              </span>
              {acledHistoricalOnly && (
                <span
                  className="px-1.5 py-0.5 rounded border border-[#d2992266] bg-[#d2992222] text-[#d29922]"
                  title="ACLED API account appears embargoed to historical data."
                >
                  historical-only (~12m lag)
                </span>
              )}
              <span style={{ color: sourceStatusColor(gdeltStatus.state) }}>
                GDELT: {gdeltStatus.message}
              </span>
            </div>
            {acledDebug && (
              <div className="mt-1 text-[10px] text-[#8b949e]">
                {acledDebug}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] text-red-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 pulse-dot" />
              LIVE
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6e7681]" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-7 pl-7 pr-3 text-xs bg-[#161b22] text-[#e6edf3] border border-[#30363d] rounded placeholder-[#6e7681] focus:outline-none focus:border-[#1f6feb]"
            data-testid="event-search"
          />
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-[#1f6feb] text-white"
                  : "text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]"
              }`}
            >
              {t.label}
              <span className={`text-[9px] px-1 rounded ${activeTab === t.key ? "bg-white/20" : "bg-[#21262d]"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-[#6e7681] text-xs">
            No verified events available from configured sources
          </div>
        ) : (
          <>
            {filtered.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                onClick={() => selectEvent(ev)}
                watchlisted={watchlistEventIds.includes(ev.id)}
                onToggleWatchlist={() => toggleWatchlistEvent(ev.id)}
              />
            ))}
            {filters.sources.includes("acled") && (
              <div className="p-3 border-t border-[#21262d]">
                <button
                  onClick={loadMoreAcled}
                  disabled={!acledHasMore || acledLoadingMore}
                  className="w-full h-8 rounded border border-[#30363d] bg-[#161b22] text-[#c9d1d9] text-xs font-medium hover:bg-[#1c2333] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {acledLoadingMore
                    ? "Loading more ACLED..."
                    : acledHasMore
                      ? "Load more ACLED"
                      : "All ACLED events loaded"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
