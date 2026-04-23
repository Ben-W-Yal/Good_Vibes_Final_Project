import type { TrackerSelection } from "../store";

interface Props {
  tracker: TrackerSelection;
  onClose: () => void;
}

function row(label: string, value: string | number) {
  return (
    <div className="bg-[#161b22] rounded p-2.5">
      <p className="text-[10px] text-[#6e7681] mb-0.5">{label}</p>
      <p className="text-[12px] text-[#e6edf3] font-medium">{value}</p>
    </div>
  );
}

export default function TrackerDetail({ tracker, onClose }: Props) {
  const color =
    tracker.kind === "aircraft"
      ? "#58a6ff"
      : tracker.kind === "ships"
        ? "#3fb950"
        : "#f0883e";

  return (
    <div
      className="absolute top-12 left-0 bottom-0 w-[380px] z-25 flex flex-col fade-in"
      style={{ background: "rgba(13,17,23,0.99)", borderRight: "1px solid #30363d" }}
      data-testid="tracker-detail"
    >
      <div className="px-4 py-3 border-b border-[#21262d]">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
            style={{ color, background: `${color}18`, border: `1px solid ${color}35` }}
          >
            {tracker.kind}
          </span>
          <button onClick={onClose} className="text-[#6e7681] hover:text-[#e6edf3] transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <h2 className="text-sm font-semibold text-[#e6edf3] leading-tight mb-1.5">
          {tracker.kind === "aircraft"
            ? tracker.data.callsign
            : tracker.kind === "ships"
              ? tracker.data.name
              : tracker.data.name}
        </h2>
        <div className="flex items-center gap-2 text-[11px]">
          <a
            href={tracker.data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1f6feb] hover:text-[#388bfd]"
          >
            {tracker.data.source}
          </a>
          <span className="text-[#6e7681]">·</span>
          <span className="text-[#8b949e]">{new Date(tracker.data.observedAt).toLocaleString()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">Position</h3>
          <div className="grid grid-cols-2 gap-2">
            {row("Latitude", tracker.data.lat.toFixed(3))}
            {row("Longitude", tracker.data.lng.toFixed(3))}
            {tracker.kind === "satellites"
              ? row("Altitude", `${tracker.data.altitude.toFixed(0)} km`)
              : row("Altitude", tracker.kind === "aircraft" ? `${tracker.data.altitude.toFixed(0)} m` : "Sea level")}
            {row(
              "Heading",
              tracker.kind === "satellites"
                ? "Orbital track"
                : `${tracker.data.heading.toFixed(0)}°`,
            )}
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">Details</h3>
          <div className="grid grid-cols-2 gap-2">
            {tracker.kind === "aircraft" && (
              <>
                {row("ID", tracker.data.id)}
                {row("Type", tracker.data.type)}
                {row("Category", tracker.data.category)}
                {row("Speed", `${tracker.data.speed.toFixed(0)} kt`)}
                {row(
                  "On ground",
                  tracker.data.onGround === true ? "Yes" : tracker.data.onGround === false ? "No" : "—",
                )}
                {row("Country", tracker.data.country)}
                {row("Company", tracker.data.carrier ?? "Military command")}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
            {tracker.kind === "ships" && (
              <>
                {row("ID", tracker.data.id)}
                {row("Type", tracker.data.type)}
                {row("Category", tracker.data.category)}
                {row("Speed", `${tracker.data.speed.toFixed(1)} kt`)}
                {row("Flag", tracker.data.flag)}
                {row("Destination", tracker.data.destination ?? "Naval patrol route")}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
            {tracker.kind === "satellites" && (
              <>
                {row("ID", tracker.data.id)}
                {row("Category", tracker.data.category)}
                {row("Orbit", tracker.data.orbit)}
                {row("Country", tracker.data.country)}
                {row("Operator", `${tracker.data.country} Space Agency`)}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
