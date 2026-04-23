import type { SourceAdapter } from "./provider";
import type { GlobeEntity } from "../types/globe";

export const vesselfinderAdapter: SourceAdapter = {
  source: "vesselfinder",
  enabled: () => Boolean(process.env.VESSELFINDER_API_KEY),
  async fetch(): Promise<GlobeEntity[]> {
    // Optional fallback adapter. Keep disabled without credentials.
    return [];
  },
};

