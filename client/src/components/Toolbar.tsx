import { useStore } from "../store";
import { MAP_LAYERS } from "../lib/cesium";
import type { ActiveRegion } from "../store";
import type { MapLayer } from "../store";

const REGIONS: ActiveRegion[] = ["Global", "Ukraine", "Middle East", "Asia", "Africa", "Americas", "Europe"];

export function Toolbar() {
  const {
    activeRegion, setActiveRegion,
    mapLayer, setMapLayer,
    setShowBriefing,
    setShowTrackers, showTrackers,
    setShowFilters, showFilters,
    sidebarOpen, setSidebarOpen,
    events,
  } = useStore();

  const liveCount = events.filter(e => e.category === "conflict").length;

  return (
    <div
      className="absolute top-0 left-0 right-0 z-30 flex items-center gap-2 px-3 h-12"
      style={{ background: "rgba(13,17,23,0.95)", borderBottom: "1px solid #30363d", backdropFilter: "blur(8px)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-3 shrink-0">
        <div className="w-7 h-7 rounded bg-[#1f6feb] flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5"/>
            <path d="M2 8h12M8 2c-2 2-2 4 0 6s2 4 0 6M8 2c2 2 2 4 0 6s-2 4 0 6" stroke="white" strokeWidth="1"/>
          </svg>
        </div>
        <span className="text-white font-semibold text-sm tracking-tight">GeoIntel</span>
        <span className="flex items-center gap-1 text-[10px] text-red-400 font-mono font-medium ml-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 pulse-dot" />
          LIVE
        </span>
      </div>

      {/* Region tabs */}
      <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
        {REGIONS.map((r) => (
          <button
            key={r}
            onClick={() => setActiveRegion(r)}
            className={`shrink-0 px-3 h-7 rounded text-xs font-medium transition-all ${
              activeRegion === r
                ? "bg-[#1f6feb] text-white"
                : "text-[#8b949e] hover:text-white hover:bg-[#21262d] border border-[#30363d]"
            }`}
            data-testid={`region-${r}`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Map layer selector */}
      <select
        value={mapLayer}
        onChange={(e) => setMapLayer(e.target.value as MapLayer)}
        className="h-7 px-2 text-xs bg-[#161b22] text-[#e6edf3] border border-[#30363d] rounded cursor-pointer outline-none hover:border-[#1f6feb] transition-colors"
        data-testid="map-layer-select"
      >
        {MAP_LAYERS.map((l) => (
          <option key={l.id} value={l.id}>{l.label}</option>
        ))}
      </select>

      {/* Toolbar actions */}
      <div className="flex items-center gap-1 ml-1">
        {/* Filter */}
        <ToolbarBtn
          active={showFilters}
          onClick={() => setShowFilters(!showFilters)}
          title="Filters"
          data-testid="btn-filter"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span>Filter</span>
        </ToolbarBtn>

        {/* Trackers */}
        <ToolbarBtn
          active={showTrackers}
          onClick={() => setShowTrackers(!showTrackers)}
          title="Trackers"
          data-testid="btn-trackers"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1 L8.5 6 L7 5.5 L5.5 6 Z" fill="currentColor"/>
            <path d="M1 6.5 L7 8 L13 6.5 L12 7.5 L7 6.5 L2 7.5 Z" fill="currentColor"/>
          </svg>
          <span>Trackers</span>
        </ToolbarBtn>

        {/* Events feed */}
        <ToolbarBtn
          active={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="Events"
          data-testid="btn-events"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2" width="12" height="2" rx="1" fill="currentColor"/>
            <rect x="1" y="6" width="9" height="2" rx="1" fill="currentColor"/>
            <rect x="1" y="10" width="11" height="2" rx="1" fill="currentColor"/>
          </svg>
          <span>Events {liveCount > 0 && <span className="text-red-400">({liveCount})</span>}</span>
        </ToolbarBtn>

        {/* PDB */}
        <button
          onClick={() => setShowBriefing(true)}
          className="flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium bg-[#1f6feb] text-white hover:bg-[#388bfd] transition-colors"
          data-testid="btn-pdb"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="3" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            <line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            <line x1="3" y1="9" x2="7" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <span>Daily Brief</span>
        </button>
      </div>
    </div>
  );
}

function ToolbarBtn({ children, active, onClick, title, ...rest }: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  [k: string]: any;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium transition-all ${
        active
          ? "bg-[#1f6feb]/20 text-[#388bfd] border border-[#1f6feb]/30"
          : "text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] border border-[#30363d]"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
