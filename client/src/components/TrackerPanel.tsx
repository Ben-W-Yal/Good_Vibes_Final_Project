/**
 * TrackerPanel — floating bottom panel for aircraft/ship/satellite filters
 * Shows live counts + toggle controls for each tracker type
 */
import { useStore } from "../store";
import type {
  TrackerAffiliation,
  AircraftGroundMode,
  AircraftSourceFilter,
  Filters,
} from "../store";
import type { CSSProperties, ReactNode } from "react";
import {
  AIRCRAFT_COCOM_ORDER,
  COCOM_META,
  emptyAircraftCocomMask,
  type AircraftCocomId,
} from "../data/cocoms";

const TYPES = [
  {
    key: "aircraft" as const,
    label: "Aircraft",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
    ),
    color: "#58a6ff",
  },
  {
    key: "ships" as const,
    label: "Ships",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.64 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.14.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z" />
      </svg>
    ),
    color: "#3fb950",
  },
  {
    key: "satellites" as const,
    label: "Satellites",
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M17 8C8 10 5.9 16.17 3.82 21c.95.23 1.96.29 2.97.1C8.67 18.29 12.01 16 17 16c0-1.08.08-2.14.23-3.16L17 8zM3.1 12.95c.57-2.5 2.2-5.56 5.9-8.14C10.17 3.96 11.75 4 13 4l-1 5c-5.32.59-8.09 2.76-8.9 3.95zM18.5 3C16.57 3 15 4.57 15 6.5V7h-2v3h2v8h3v-8h2V7h-2v-.5c0-.28.22-.5.5-.5H20V3h-1.5z" />
      </svg>
    ),
    color: "#f0883e",
  },
];

const AIRCRAFT_COLOR = "#58a6ff";

export default function TrackerPanel() {
  const { showTrackers, setShowTrackers, filters, setFilters, setTrackerAffiliation, aircraft, ships, satellites } =
    useStore();

  if (!showTrackers) return null;

  const counts = {
    aircraft: aircraft.length,
    ships: ships.length,
    satellites: satellites.length,
  };

  const aircraftOn = filters.trackerTypes.includes("aircraft");

  const toggleType = (key: "aircraft" | "ships" | "satellites") => {
    const current = filters.trackerTypes;
    const next = current.includes(key) ? current.filter((t) => t !== key) : [...current, key];
    setFilters({ trackerTypes: next });
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 10,
        padding: "12px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 500,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        minWidth: 360,
        maxWidth: "min(960px, calc(100vw - 32px))",
      }}
    >
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            color: "#8b949e",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Live Trackers
        </span>

        {TYPES.map(({ key, label, icon, color }) => {
          const active = filters.trackerTypes.includes(key);
          const affiliation = filters.trackerAffiliations[key];
          return (
            <div
              key={key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <button
                data-testid={`tracker-toggle-${key}`}
                onClick={() => toggleType(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: active ? `${color}22` : "transparent",
                  border: `1px solid ${active ? color : "#30363d"}`,
                  borderRadius: 6,
                  padding: "6px 12px",
                  cursor: "pointer",
                  color: active ? color : "#6e7681",
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ color: active ? color : "#6e7681" }}>{icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
                <span
                  style={{
                    background: active ? color : "#30363d",
                    color: active ? "#fff" : "#6e7681",
                    borderRadius: 10,
                    padding: "1px 7px",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {counts[key]}
                </span>
              </button>
              <AffiliationPills
                disabled={!active}
                value={affiliation}
                color={color}
                onChange={(next) => setTrackerAffiliation(key, next)}
              />
            </div>
          );
        })}

        <button
          data-testid="tracker-panel-close"
          onClick={() => setShowTrackers(false)}
          style={{
            background: "none",
            border: "none",
            color: "#6e7681",
            cursor: "pointer",
            fontSize: 16,
            marginLeft: "auto",
            padding: "2px 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {aircraftOn && <AircraftOptions filters={filters} setFilters={setFilters} />}
    </div>
  );
}

function AircraftOptions({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (partial: Partial<Filters>) => void;
}) {
  const pill = (selected: boolean) => ({
    border: `1px solid ${selected ? AIRCRAFT_COLOR : "#30363d"}`,
    color: selected ? AIRCRAFT_COLOR : "#8b949e",
    background: selected ? "#58a6ff1f" : "#0d1117",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer" as const,
  });

  const inputStyle: CSSProperties = {
    width: 64,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 4,
    color: "#e6edf3",
    fontSize: 11,
    padding: "4px 6px",
    fontFamily: "JetBrains Mono, monospace",
  };

  const textInputStyle: CSSProperties = {
    ...inputStyle,
    width: 100,
  };

  const resetAircraftFilters = () =>
    setFilters({
      aircraftGroundMode: "all",
      aircraftAltMinFt: 0,
      aircraftAltMaxFt: 60_000,
      aircraftSpeedMinKt: 0,
      aircraftSpeedMaxKt: 800,
      aircraftCallsignQuery: "",
      aircraftCountryQuery: "",
      aircraftSourceFilter: "all",
      aircraftCocoms: emptyAircraftCocomMask(),
    });

  const toggleCocom = (id: AircraftCocomId) =>
    setFilters({
      aircraftCocoms: { ...filters.aircraftCocoms, [id]: !filters.aircraftCocoms[id] },
    });

  return (
    <div
      style={{
        borderTop: "1px solid #30363d",
        paddingTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span style={{ color: "#8b949e", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Flight load</span>
        <div style={{ display: "flex", gap: 6 }}>
          {[100, 300, 600, 1000].map((n) => {
            const selected = filters.aircraftMaxVisible === n;
            return (
              <button key={n} onClick={() => setFilters({ aircraftMaxVisible: n })} style={pill(selected)}>
                {n}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setFilters({ aircraftShowLabels: !filters.aircraftShowLabels })}
          style={{
            ...pill(filters.aircraftShowLabels),
            borderRadius: 6,
            textTransform: "uppercase",
          }}
        >
          Labels {filters.aircraftShowLabels ? "On" : "Off"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#8b949e", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
            COCOM AOR
          </span>
          <span style={{ color: "#6e7681", fontSize: 10, maxWidth: 420, lineHeight: 1.35 }}>
            No selection = worldwide. Enable commands to show flights only inside their approximate AORs (union).
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {AIRCRAFT_COCOM_ORDER.map((id) => {
            const on = filters.aircraftCocoms[id];
            const { short, hint } = COCOM_META[id];
            return (
              <button
                key={id}
                type="button"
                title={hint}
                onClick={() => toggleCocom(id)}
                style={pill(on)}
              >
                {short}
              </button>
            );
          })}
          <button type="button" onClick={() => setFilters({ aircraftCocoms: emptyAircraftCocomMask() })} style={pill(false)}>
            Clear AOR
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <Field label="Surface">
          <div style={{ display: "flex", gap: 4 }}>
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "airborne" as const, label: "Air" },
                { id: "ground" as const, label: "GND" },
              ] satisfies { id: AircraftGroundMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFilters({ aircraftGroundMode: opt.id })}
                style={pill(filters.aircraftGroundMode === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Source">
          <div style={{ display: "flex", gap: 4 }}>
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "opensky" as const, label: "OpenSky" },
                { id: "verified" as const, label: "Verified" },
              ] satisfies { id: AircraftSourceFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFilters({ aircraftSourceFilter: opt.id })}
                style={pill(filters.aircraftSourceFilter === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Alt (ft)">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="number"
              min={0}
              max={60000}
              value={filters.aircraftAltMinFt}
              onChange={(e) => setFilters({ aircraftAltMinFt: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
            <span style={{ color: "#6e7681", fontSize: 11 }}>–</span>
            <input
              type="number"
              min={0}
              max={60000}
              value={filters.aircraftAltMaxFt}
              onChange={(e) => setFilters({ aircraftAltMaxFt: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field label="Speed (kt)">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="number"
              min={0}
              max={2000}
              value={filters.aircraftSpeedMinKt}
              onChange={(e) => setFilters({ aircraftSpeedMinKt: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
            <span style={{ color: "#6e7681", fontSize: 11 }}>–</span>
            <input
              type="number"
              min={0}
              max={2000}
              value={filters.aircraftSpeedMaxKt}
              onChange={(e) => setFilters({ aircraftSpeedMaxKt: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field label="Callsign">
          <input
            type="text"
            placeholder="contains…"
            value={filters.aircraftCallsignQuery}
            onChange={(e) => setFilters({ aircraftCallsignQuery: e.target.value })}
            style={textInputStyle}
          />
        </Field>

        <Field label="Country">
          <input
            type="text"
            placeholder="contains…"
            value={filters.aircraftCountryQuery}
            onChange={(e) => setFilters({ aircraftCountryQuery: e.target.value })}
            style={textInputStyle}
          />
        </Field>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() =>
              setFilters({
                aircraftAltMinFt: 25_000,
                aircraftAltMaxFt: 45_000,
                aircraftGroundMode: "airborne",
                aircraftSpeedMinKt: 200,
                aircraftSpeedMaxKt: 800,
              })
            }
            style={pill(false)}
          >
            Cruise band
          </button>
          <button
            type="button"
            onClick={() =>
              setFilters({
                aircraftGroundMode: "ground",
                aircraftAltMinFt: 0,
                aircraftAltMaxFt: 2500,
                aircraftSpeedMinKt: 0,
                aircraftSpeedMaxKt: 60,
              })
            }
            style={pill(false)}
          >
            Taxi / ramp
          </button>
          <button type="button" onClick={resetAircraftFilters} style={pill(false)}>
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#8b949e", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{label}</span>
      {children}
    </div>
  );
}

function AffiliationPills({
  value,
  onChange,
  color,
  disabled,
}: {
  value: TrackerAffiliation;
  onChange: (v: TrackerAffiliation) => void;
  color: string;
  disabled: boolean;
}) {
  const opts: { id: TrackerAffiliation; label: string }[] = [
    { id: "all", label: "All" },
    { id: "civilian", label: "Civilian" },
    { id: "military", label: "Military" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, opacity: disabled ? 0.5 : 1 }}>
      {opts.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => !disabled && onChange(opt.id)}
            style={{
              border: `1px solid ${selected ? color : "#30363d"}`,
              color: selected ? color : "#8b949e",
              background: selected ? `${color}1f` : "#0d1117",
              borderRadius: 999,
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 600,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
