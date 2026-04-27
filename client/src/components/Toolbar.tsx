import { useStore } from "../store";
import { MAP_LAYERS } from "../lib/cesium";
import type { ActiveRegion } from "../store";
import type { MapLayer } from "../store";
import {
  connectSpaceMouse,
  disconnectSpaceMouse,
  getControlConfig,
  getDebugState,
  resetControlConfig,
  setControlConfig,
  getStatus,
} from "../lib/spacemouse";
import { useEffect, useState } from "react";

const REGIONS: ActiveRegion[] = ["Middle East", "Asia", "Africa", "Americas", "Europe"];

export function Toolbar() {
  const {
    activeRegion, setActiveRegion,
    mapLayer, setMapLayer,
    setShowBriefing,
    setShowTrackers, showTrackers,
    setShowFilters, showFilters,
    sidebarOpen, setSidebarOpen,
  } = useStore();
  const [spaceMouseStatus, setSpaceMouseStatus] = useState(() => getStatus());
  const [spaceMouseBusy, setSpaceMouseBusy] = useState(false);
  const [spaceMouseDebug, setSpaceMouseDebug] = useState(() => getDebugState());
  const [spaceMouseTuneOpen, setSpaceMouseTuneOpen] = useState(false);
  const [spaceMouseControl, setSpaceMouseControlState] = useState(() => getControlConfig());

  useEffect(() => {
    const onStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<ReturnType<typeof getStatus>>).detail;
      if (detail) setSpaceMouseStatus(detail);
      else setSpaceMouseStatus(getStatus());
    };
    window.addEventListener("spacemouse-status", onStatus);
    return () => window.removeEventListener("spacemouse-status", onStatus);
  }, []);

  useEffect(() => {
    const onDebug = (ev: Event) => {
      const detail = (ev as CustomEvent<ReturnType<typeof getDebugState>>).detail;
      if (detail) setSpaceMouseDebug(detail);
      else setSpaceMouseDebug(getDebugState());
    };
    window.addEventListener("spacemouse-debug", onDebug);
    return () => window.removeEventListener("spacemouse-debug", onDebug);
  }, []);

  useEffect(() => {
    const onConfig = (ev: Event) => {
      const detail = (ev as CustomEvent<ReturnType<typeof getControlConfig>>).detail;
      if (detail) setSpaceMouseControlState(detail);
      else setSpaceMouseControlState(getControlConfig());
    };
    window.addEventListener("spacemouse-config", onConfig);
    return () => window.removeEventListener("spacemouse-config", onConfig);
  }, []);

  async function toggleSpaceMouse() {
    if (spaceMouseBusy) return;
    setSpaceMouseBusy(true);
    try {
      if (spaceMouseStatus.connected) {
        setSpaceMouseStatus(await disconnectSpaceMouse());
      } else {
        setSpaceMouseStatus(await connectSpaceMouse());
      }
    } catch {
      setSpaceMouseStatus(getStatus());
    } finally {
      setSpaceMouseBusy(false);
    }
  }

  function updateSpaceMouseControl(partial: Partial<ReturnType<typeof getControlConfig>>) {
    const next = setControlConfig(partial);
    setSpaceMouseControlState(next);
  }

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
            className={`shrink-0 px-2 h-6 rounded text-[11px] font-medium transition-all ${
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
          <span>Events</span>
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

        <button
          onClick={toggleSpaceMouse}
          disabled={!spaceMouseStatus.supported || spaceMouseBusy}
          className={`flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors ${
            spaceMouseStatus.connected
              ? "bg-[#238636] text-white hover:bg-[#2ea043]"
              : "bg-[#161b22] text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d]"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          data-testid="btn-spacemouse"
          title={`${spaceMouseStatus.label} | reports:${spaceMouseDebug.reportCount} lastId:${spaceMouseDebug.lastReportId} bytes:${spaceMouseDebug.lastReportBytes}`}
        >
          <span>{spaceMouseBusy ? "..." : "3D Mouse"}</span>
        </button>
        <button
          onClick={() => setSpaceMouseTuneOpen((v) => !v)}
          className={`h-7 px-2 rounded text-xs font-medium border transition-colors ${
            spaceMouseTuneOpen
              ? "bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/40"
              : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:bg-[#21262d] hover:text-[#e6edf3]"
          }`}
          title="Tune 3D Mouse camera controls"
          data-testid="btn-spacemouse-tune"
        >
          3D Tune
        </button>
      </div>
      {spaceMouseTuneOpen && (
        <div
          className="absolute top-14 right-3 w-[280px] rounded border border-[#30363d] bg-[#161b22] p-3 shadow-xl"
          data-testid="spacemouse-tune-panel"
        >
          <div className="mb-2 text-xs font-semibold text-[#e6edf3]">3D Mouse Camera Tune</div>
          <div className="space-y-2 text-[11px] text-[#8b949e]">
            <label className="block">
              Camera mode
              <select
                value={spaceMouseControl.cameraMode}
                onChange={(e) =>
                  updateSpaceMouseControl({
                    cameraMode: e.target.value as ReturnType<typeof getControlConfig>["cameraMode"],
                  })
                }
                className="mt-1 h-7 w-full rounded border border-[#30363d] bg-[#0d1117] px-2 text-xs text-[#e6edf3]"
              >
                <option value="helicopter">Helicopter (leveled)</option>
                <option value="cinematic">Cinematic (full 6-DOF)</option>
              </select>
            </label>
            <label className="block">
              Move speed: {spaceMouseControl.moveSpeed.toFixed(2)}x
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={spaceMouseControl.moveSpeed}
                onChange={(e) => updateSpaceMouseControl({ moveSpeed: Number(e.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="block">
              Lateral pan boost: {spaceMouseControl.lateralBoost.toFixed(2)}x
              <input
                type="range"
                min={0.4}
                max={3.5}
                step={0.05}
                value={spaceMouseControl.lateralBoost}
                onChange={(e) => updateSpaceMouseControl({ lateralBoost: Number(e.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="block">
              Rotate speed: {spaceMouseControl.rotateSpeed.toFixed(2)}x
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={spaceMouseControl.rotateSpeed}
                onChange={(e) => updateSpaceMouseControl({ rotateSpeed: Number(e.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="block">
              Tilt effect (pitch axis): {spaceMouseControl.tiltEffect.toFixed(2)}x
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.05}
                value={spaceMouseControl.tiltEffect}
                onChange={(e) => updateSpaceMouseControl({ tiltEffect: Number(e.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="flex items-center gap-2 text-[#c9d1d9]">
              <input
                type="checkbox"
                checked={spaceMouseControl.invertTilt}
                onChange={(e) => updateSpaceMouseControl({ invertTilt: e.target.checked })}
              />
              Invert tilt direction
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-[#6e7681]">Saved per browser (local)</span>
            <button
              onClick={() => setSpaceMouseControlState(resetControlConfig())}
              className="h-7 rounded border border-[#30363d] px-2 text-xs text-[#c9d1d9] hover:bg-[#21262d]"
              data-testid="btn-spacemouse-reset"
            >
              Reset
            </button>
          </div>
        </div>
      )}
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
