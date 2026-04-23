import { useEffect, useMemo, useState } from "react";
import type { GlobeEntity, GlobeSource, SourceQuery } from "../types/globe";

export function useLiveLayer(source: GlobeSource, params: SourceQuery = {}) {
  const [data, setData] = useState<GlobeEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = useMemo(() => JSON.stringify({ source, ...params }), [source, params]);

  useEffect(() => {
    let closed = false;
    const isStreaming = source === "aisstream";

    if (isStreaming) {
      // TODO: wire to server WS endpoint once AISStream rebroadcast is enabled.
      return;
    }

    async function poll() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/${source}/events`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const rows = (await res.json()) as GlobeEntity[];
        if (!closed) setData(rows);
      } catch (err) {
        if (!closed) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!closed) setLoading(false);
      }
    }

    void poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [key, source]);

  return { data, loading, error };
}

