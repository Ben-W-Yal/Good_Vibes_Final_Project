import { useState } from "react";
import { useStore } from "../store";
import { getIconClass, SEVERITY_COLOR, type GeoEvent, type Category } from "../data/events";

const CATEGORY_LABELS: Record<Category, string> = {
  conflict: "Global Conflicts",
  domestic: "Domestic",
  local:    "Local",
  social:   "Social",
};

function formatAbsolute(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

function EventCard({ event, onClick }: { event: GeoEvent; onClick: () => void }) {
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
  if (type.includes("Drone")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="3" cy="3" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="9" cy="3" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="3" cy="9" r="1.5" stroke="white" strokeWidth="1"/>
      <circle cx="9" cy="9" r="1.5" stroke="white" strokeWidth="1"/>
      <rect x="4.5" y="4.5" width="3" height="3" rx="0.6" fill="white"/>
    </svg>;
  }
  if (type.includes("Bomb") || type.includes("Explosion")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="5.5" cy="7" r="3" fill="white"/>
      <path d="M8.3 3.2L10.5 1" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M8 4L9.5 5.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>;
  }
  if (type.includes("Shooting") || type.includes("Attack") || type.includes("Clashes")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1.5 7.5L7.8 5.2L8.8 6.2L11 5.6L9.4 4L8 2.5L7.4 4.7L6.4 5.7L1.5 7.5Z" fill="white"/>
    </svg>;
  }
  if (type.includes("Missile") || type.includes("Rocket")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L7.5 7 L6 6 L4.5 7 Z" fill="white"/>
      <path d="M2 7 L10 7 L9 8 L3 8 Z" fill="white" opacity="0.7"/>
    </svg>;
  }
  if (type.includes("Airstrike") || type.includes("Strike")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L7 6 L6 5.5 L5 6 Z" fill="white"/>
      <path d="M1 5.5 L6 7 L11 5.5 L10.5 6.5 L6 5.5 L1.5 6.5 Z" fill="white" opacity="0.7"/>
    </svg>;
  }
  if (type.includes("Clash") || type.includes("Ground") || type.includes("Ambush")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3 L9 9 M9 3 L3 9" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>;
  }
  if (type.includes("Maritime")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <ellipse cx="6" cy="7" rx="3.5" ry="4" fill="none" stroke="white" strokeWidth="1.2"/>
      <path d="M6 2 L7.5 5 L4.5 5 Z" fill="white"/>
    </svg>;
  }
  if (type.includes("Protest")) {
    return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="4" r="2" fill="white"/>
      <rect x="4" y="7" width="4" height="4" rx="1" fill="white"/>
    </svg>;
  }
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="3.5" fill="white" opacity="0.9"/>
  </svg>;
}

export function EventSidebar() {
  const { sidebarOpen, events, filters, selectEvent, activeRegion } = useStore();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Category | "all">("all");

  if (!sidebarOpen) return null;

  const cutoffMs = Date.now() - filters.timeRangeHours * 3_600_000;
  const filtered = events
    .filter((ev) => {
      // Apply the user's time window to every source so the filter behaves
      // predictably. ACLED rows are embargoed ~13 months upstream, so they'll
      // only surface when the range is 30d+ (or 1y) — that's intended.
      const t = new Date(ev.updatedAt).getTime();
      if (Number.isFinite(t) && t < cutoffMs) return false;
      if (!filters.categories.includes(ev.category)) return false;
      if (!filters.severities.includes(ev.severity)) return false;
      if (activeTab !== "all" && ev.category !== activeTab) return false;
      if (
        search &&
        !ev.title.toLowerCase().includes(search.toLowerCase()) &&
        !ev.country.toLowerCase().includes(search.toLowerCase()) &&
        !ev.region.toLowerCase().includes(search.toLowerCase()) &&
        !ev.source.toLowerCase().includes(search.toLowerCase())
      )
        return false;
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

  const tabs: Array<{ key: Category | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: events.length },
    { key: "conflict", label: "Conflict", count: events.filter(e => e.category === "conflict").length },
    { key: "domestic", label: "Domestic", count: events.filter(e => e.category === "domestic").length },
    { key: "local", label: "Local", count: events.filter(e => e.category === "local").length },
    { key: "social", label: "Social", count: events.filter(e => e.category === "social").length },
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
            <h2 className="text-sm font-semibold text-[#e6edf3]">News Live</h2>
            <p className="text-[10px] text-[#8b949e]">
              Updated {new Date().toLocaleTimeString()} · {filtered.length} events
            </p>
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
          filtered.map((ev) => (
            <EventCard key={ev.id} event={ev} onClick={() => selectEvent(ev)} />
          ))
        )}
      </div>
    </div>
  );
}
