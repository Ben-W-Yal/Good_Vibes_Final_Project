import { useEffect, useState } from "react";
import type { TrackerSelection } from "../store";
import type { Satellite } from "../data/trackers";

interface Props {
  tracker: TrackerSelection;
  onClose: () => void;
}

type SatelliteIntel = {
  summary: string;
  country?: string;
  operator?: string;
  launchDate?: string;
  launchVehicle?: string;
  launchSite?: string;
  yearsInOrbit?: string;
  purpose?: string;
  orbit?: string;
  confidence?: string;
  sources: { title: string; url: string }[];
  generatedAt: string;
  model?: string;
};

type TrackerIntel = {
  summary: string;
  airline?: string;
  operator?: string;
  country?: string;
  registration?: string;
  modelOrClass?: string;
  origin?: string;
  destination?: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  flightStatus?: string;
  role?: string;
  owner?: string;
  flag?: string;
  built?: string;
  confidence?: string;
  sources: { title: string; url: string }[];
  generatedAt: string;
  model?: string;
};

function row(label: string, value: string | number) {
  return (
    <div className="bg-[#161b22] rounded p-2.5">
      <p className="text-[10px] text-[#6e7681] mb-0.5">{label}</p>
      <p className="text-[12px] text-[#e6edf3] font-medium">{value}</p>
    </div>
  );
}

function satellitePurpose(sat: Satellite): string {
  if (isIss(sat)) {
    return "a permanently crewed orbital laboratory supporting human spaceflight, microgravity science, Earth observation, technology demonstrations, spacecraft operations, and international cooperation.";
  }
  switch (sat.category) {
    case "navigation":
      return "positioning, navigation, and timing services used by receivers on the ground, at sea, and in the air.";
    case "weather":
      return "Earth observation and meteorological monitoring, including cloud systems, storms, fires, and atmospheric conditions.";
    case "military":
      return "defense, intelligence, communications, early-warning, surveillance, or other national-security missions.";
    case "scientific":
      return "research, Earth science, astronomy, or technology demonstration missions.";
    case "communications":
    default:
      return "communications, relay, broadcast, or data-transfer services between ground stations and users.";
  }
}

function orbitMeaning(sat: Satellite): string {
  if (isIss(sat)) {
    return "Its low Earth orbit lets crews and cargo vehicles reach it regularly, while still circling Earth roughly every 90 minutes for repeated science and Earth-observation passes.";
  }
  if (sat.orbit === "LEO") return "Its low Earth orbit gives faster passes and lower latency, but it only sees a region for a short time each orbit.";
  if (sat.orbit === "MEO") return "Its medium Earth orbit provides wider coverage than LEO and is common for navigation constellations.";
  if (sat.orbit === "GEO") return "Its geostationary-range altitude keeps it near the same longitude, useful for persistent regional coverage.";
  return "Its high or elliptical orbit can support long dwell times over selected regions.";
}

function isIss(sat: Satellite): boolean {
  return sat.id === "sat-25544" || /international space station|iss \(zarya\)|\biss\b/i.test(sat.name);
}

function satelliteSummary(sat: Satellite): string {
  if (isIss(sat)) {
    return "The International Space Station (ISS) is a continuously crewed research complex operated by an international partnership led by NASA, Roscosmos, ESA, JAXA, and CSA. Its mission is to support long-duration human spaceflight, microgravity biology and materials research, Earth and space observation, technology testing, and operational experience for future Moon and Mars missions. The ISS also serves as a logistics and rendezvous platform for crew and cargo spacecraft. Its low Earth orbit, roughly 400 km above Earth, gives astronauts frequent sunrises, repeated ground-track passes, and rapid orbital motion around the planet.";
  }
  const n = sat.name.toLowerCase();
  if (/gps|navstar/.test(n)) {
    return `${sat.name} is part of the GPS navigation architecture, providing precise timing and ranging signals used by military, civil, aviation, maritime, and mobile users. Its orbit is chosen to support broad sky visibility from Earth, so receivers can combine signals from multiple satellites for accurate positioning.`;
  }
  if (/noaa|goes|metop|meteor|himawari|fengyun/.test(n)) {
    return `${sat.name} supports weather and environmental monitoring. Satellites in this class collect atmospheric, oceanic, cloud, storm, and sometimes fire or climate observations that feed forecasting and situational awareness systems.`;
  }
  if (/hubble/.test(n)) {
    return `${sat.name} is a scientific observatory used for astronomy and astrophysics. Its orbit above most of Earth's atmosphere lets instruments collect sharper observations than ground telescopes can usually obtain.`;
  }
  if (/starlink/.test(n)) {
    return `${sat.name} is part of a low Earth orbit communications constellation designed to provide broadband connectivity. LEO placement reduces latency compared with geostationary communications satellites, but requires many satellites for continuous coverage.`;
  }
  return `${sat.name} is a ${sat.category} satellite currently propagated from live CelesTrak TLE data using SGP4. It is at roughly ${sat.altitude.toFixed(0)} km altitude in ${sat.orbit} orbit. It is primarily used for ${satellitePurpose(sat)} ${orbitMeaning(sat)}`;
}

const SUGGESTED_SATELLITE_QUESTIONS = [
  "What is this satellite used for?",
  "Why is its orbit altitude important?",
  "When will it pass over my area?",
];

function answerSatelliteQuestion(sat: Satellite, question: string): string {
  const q = question.toLowerCase();
  if (q.includes("used for") || q.includes("what is")) {
    if (isIss(sat)) {
      return "The ISS is used as an orbiting research laboratory and human spaceflight testbed. Crews conduct microgravity experiments, study how long-duration spaceflight affects humans, test life-support and spacecraft operations, observe Earth, host commercial payloads, and support international astronaut missions.";
    }
    return `${sat.name} is categorized as ${sat.category}. Based on that category, it is likely used for ${satellitePurpose(sat)} The current tracker uses public orbital elements, so mission details may be broad rather than classified/operator-specific.`;
  }
  if (q.includes("orbit") || q.includes("altitude") || q.includes("important")) {
    if (isIss(sat)) {
      return `The ISS orbits at about ${sat.altitude.toFixed(0)} km, low enough for regular crew/cargo access but high enough to reduce atmospheric drag compared with very low orbits. That altitude gives it a fast orbital period of about 90 minutes and repeated observation opportunities over different parts of Earth.`;
    }
    return `${sat.name} is currently modeled at about ${sat.altitude.toFixed(0)} km in ${sat.orbit} orbit. ${orbitMeaning(sat)} Altitude also affects revisit timing, coverage footprint, latency, and how quickly the satellite appears to move across the sky.`;
  }
  if (q.includes("pass") || q.includes("area") || q.includes("over")) {
    return `This app shows the satellite's current subpoint and orbit trail, but it does not yet calculate observer-specific pass predictions. To answer exact pass times, we would need your observer location and compute look angles over time from the same TLE.`;
  }
  return `${sat.name} is shown from live TLE propagation. It is a ${sat.category} satellite in ${sat.orbit} orbit at about ${sat.altitude.toFixed(0)} km altitude. Ask about its use, orbit altitude, or pass timing for more detail.`;
}

export default function TrackerDetail({ tracker, onClose }: Props) {
  const [satQuestion, setSatQuestion] = useState("");
  const [satAnswer, setSatAnswer] = useState("");
  const [satIntel, setSatIntel] = useState<SatelliteIntel | null>(null);
  const [satIntelState, setSatIntelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [satIntelError, setSatIntelError] = useState("");
  const [trackerIntel, setTrackerIntel] = useState<TrackerIntel | null>(null);
  const [trackerIntelState, setTrackerIntelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [trackerIntelError, setTrackerIntelError] = useState("");
  const color =
    tracker.kind === "aircraft"
      ? "#58a6ff"
      : tracker.kind === "ships"
        ? "#3fb950"
        : "#f0883e";

  const selectedSatellite = tracker.kind === "satellites" ? tracker.data : null;
  const selectedLiveTracker = tracker.kind === "aircraft" || tracker.kind === "ships" ? tracker : null;

  useEffect(() => {
    if (!selectedSatellite) {
      setSatIntel(null);
      setSatIntelState("idle");
      setSatIntelError("");
      return;
    }

    setSatIntel(null);
    setSatAnswer("");
    setSatQuestion("");
    setSatIntelError("");
    setSatIntelState("loading");
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/trackers/satellites/intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ satellite: selectedSatellite }),
        });
        if (!res.ok) {
          const info = await res.json().catch(() => null as unknown);
          const reason =
            info && typeof info === "object" && "reason" in info && typeof (info as { reason?: unknown }).reason === "string"
              ? (info as { reason: string }).reason
              : `Satellite AI lookup failed (${res.status})`;
          throw new Error(reason);
        }
        const payload = (await res.json()) as SatelliteIntel;
        setSatIntel(payload);
        setSatIntelState("ready");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setSatIntelError(err instanceof Error ? err.message : "Satellite AI lookup failed.");
        setSatIntelState("error");
      }
    })();

    return () => controller.abort();
  }, [selectedSatellite?.id]);

  useEffect(() => {
    if (!selectedLiveTracker) {
      setTrackerIntel(null);
      setTrackerIntelState("idle");
      setTrackerIntelError("");
      return;
    }

    setTrackerIntel(null);
    setTrackerIntelError("");
    setTrackerIntelState("loading");
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/trackers/intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            kind: selectedLiveTracker.kind,
            tracker: selectedLiveTracker.data,
          }),
        });
        if (!res.ok) {
          const info = await res.json().catch(() => null as unknown);
          const reason =
            info && typeof info === "object" && "reason" in info && typeof (info as { reason?: unknown }).reason === "string"
              ? (info as { reason: string }).reason
              : `Tracker AI lookup failed (${res.status})`;
          throw new Error(reason);
        }
        const payload = (await res.json()) as TrackerIntel;
        setTrackerIntel(payload);
        setTrackerIntelState("ready");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setTrackerIntelError(err instanceof Error ? err.message : "Tracker AI lookup failed.");
        setTrackerIntelState("error");
      }
    })();

    return () => controller.abort();
  }, [selectedLiveTracker?.kind, selectedLiveTracker?.data.id]);

  const askSatellite = async (question: string) => {
    if (!selectedSatellite) return;
    setSatQuestion(question);
    setSatAnswer("Searching open sources...");
    try {
      const res = await fetch("/api/trackers/satellites/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satellite: selectedSatellite, question }),
      });
      if (!res.ok) {
        const info = await res.json().catch(() => null as unknown);
        const reason =
          info && typeof info === "object" && "reason" in info && typeof (info as { reason?: unknown }).reason === "string"
            ? (info as { reason: string }).reason
            : `Satellite AI lookup failed (${res.status})`;
        throw new Error(reason);
      }
      const payload = (await res.json()) as SatelliteIntel;
      setSatAnswer(payload.summary);
    } catch (err) {
      setSatAnswer(
        err instanceof Error && err.message
          ? err.message
          : answerSatelliteQuestion(selectedSatellite, question),
      );
    }
  };

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
                {row("Country", trackerIntel?.country ?? tracker.data.country)}
                {trackerIntel?.airline && row("Airline", trackerIntel.airline)}
                {row("Operator", trackerIntel?.operator ?? tracker.data.carrier ?? "AI lookup pending")}
                {trackerIntel?.registration && row("Registration", trackerIntel.registration)}
                {trackerIntel?.modelOrClass && row("Model", trackerIntel.modelOrClass)}
                {trackerIntel?.origin && row("From", trackerIntel.origin)}
                {trackerIntel?.destination && row("To", trackerIntel.destination)}
                {trackerIntel?.scheduledDeparture && row("Departure", trackerIntel.scheduledDeparture)}
                {trackerIntel?.scheduledArrival && row("Arrival", trackerIntel.scheduledArrival)}
                {trackerIntel?.flightStatus && row("Status", trackerIntel.flightStatus)}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
            {tracker.kind === "ships" && (
              <>
                {row("ID", tracker.data.id)}
                {row("Type", tracker.data.type)}
                {row("Category", tracker.data.category)}
                {row("Speed", `${tracker.data.speed.toFixed(1)} kt`)}
                {row("Flag", trackerIntel?.flag ?? tracker.data.flag)}
                {trackerIntel?.operator && row("Operator", trackerIntel.operator)}
                {trackerIntel?.owner && row("Owner", trackerIntel.owner)}
                {trackerIntel?.registration && row("IMO/MMSI", trackerIntel.registration)}
                {trackerIntel?.modelOrClass && row("Class/type", trackerIntel.modelOrClass)}
                {trackerIntel?.built && row("Built", trackerIntel.built)}
                {tracker.data.mmsi && row("MMSI", tracker.data.mmsi)}
                {tracker.data.imo && row("IMO", tracker.data.imo)}
                {tracker.data.callsign && row("Callsign", tracker.data.callsign)}
                {tracker.data.navStatus && row("Nav status", tracker.data.navStatus)}
                {tracker.data.eta && row("ETA", tracker.data.eta)}
                {row("Destination", tracker.data.destination ?? "Naval patrol route")}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
            {tracker.kind === "satellites" && (
              <>
                {row("ID", tracker.data.id)}
                {row("Category", tracker.data.category)}
                {row("Affiliation", tracker.data.affiliation ?? (tracker.data.category === "military" ? "military" : "civilian"))}
                {row("Orbit", tracker.data.orbit)}
                {row("Country", satIntel?.country ?? tracker.data.country)}
                {row("Operator", satIntel?.operator ?? "AI lookup pending")}
                {satIntel?.launchDate && row("Launch", satIntel.launchDate)}
                {satIntel?.launchVehicle && row("Launch vehicle", satIntel.launchVehicle)}
                {satIntel?.launchSite && row("Launch site", satIntel.launchSite)}
                {satIntel?.yearsInOrbit && row("Time in orbit", satIntel.yearsInOrbit)}
                {row("Trail points", tracker.data.trail.length)}
              </>
            )}
          </div>
        </div>
        {selectedLiveTracker && (
          <div className="space-y-3">
            <div>
              <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                AI Summary
              </h3>
              <div className="rounded border border-[#30363d] bg-[#161b22] p-3 text-[12px] leading-relaxed text-[#c9d1d9]">
                {trackerIntelState === "loading"
                  ? `Searching open sources for this ${selectedLiveTracker.kind === "aircraft" ? "aircraft" : "ship"}...`
                  : trackerIntelState === "error"
                    ? trackerIntelError
                    : trackerIntel?.summary ?? "No researched summary returned."}
              </div>
              {trackerIntel && (
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {trackerIntel.role && row("AI-found role", trackerIntel.role)}
                  {trackerIntel.confidence && row("AI confidence", trackerIntel.confidence)}
                </div>
              )}
              {trackerIntel?.sources?.length ? (
                <div className="mt-2 rounded border border-[#30363d] bg-[#0d1117] p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]">
                    Open-source references
                  </p>
                  <div className="space-y-1">
                    {trackerIntel.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[11px] text-[#1f6feb] hover:text-[#388bfd]"
                        title={source.url}
                      >
                        {source.title}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {selectedSatellite && (
          <div className="space-y-3">
            <div>
              <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                AI Summary
              </h3>
              <div className="rounded border border-[#30363d] bg-[#161b22] p-3 text-[12px] leading-relaxed text-[#c9d1d9]">
                {satIntelState === "loading"
                  ? "Searching open sources by satellite ID and name..."
                  : satIntelState === "error"
                    ? satIntelError || satelliteSummary(selectedSatellite)
                    : satIntel?.summary ?? satelliteSummary(selectedSatellite)}
              </div>
              {satIntel && (
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {satIntel.purpose && row("AI-found purpose", satIntel.purpose)}
                  {satIntel.orbit && row("AI-found orbit notes", satIntel.orbit)}
                  {satIntel.confidence && row("AI confidence", satIntel.confidence)}
                </div>
              )}
              {satIntel?.sources?.length ? (
                <div className="mt-2 rounded border border-[#30363d] bg-[#0d1117] p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]">
                    Open-source references
                  </p>
                  <div className="space-y-1">
                    {satIntel.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[11px] text-[#1f6feb] hover:text-[#388bfd]"
                        title={source.url}
                      >
                        {source.title}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <h3 className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                Ask About This Satellite
              </h3>
              <div className="space-y-2 rounded border border-[#30363d] bg-[#161b22] p-3">
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_SATELLITE_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => askSatellite(q)}
                      className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[10px] font-semibold text-[#8b949e] hover:border-[#f0883e] hover:text-[#f0883e]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={satQuestion}
                    onChange={(e) => setSatQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && satQuestion.trim()) askSatellite(satQuestion.trim());
                    }}
                    placeholder="Ask a satellite question..."
                    className="min-w-0 flex-1 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-[12px] text-[#e6edf3] outline-none focus:border-[#f0883e]"
                  />
                  <button
                    type="button"
                    onClick={() => satQuestion.trim() && askSatellite(satQuestion.trim())}
                    className="rounded bg-[#f0883e] px-2 py-1.5 text-[11px] font-semibold text-[#0d1117] hover:bg-[#ffa657]"
                  >
                    Ask
                  </button>
                </div>
                {satAnswer && (
                  <div className="rounded bg-[#0d1117] p-2 text-[12px] leading-relaxed text-[#c9d1d9]">
                    {satAnswer}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
