import type { SourceAdapter } from "./provider";
import type { GlobeEntity } from "../types/globe";

export const n2yoAdapter: SourceAdapter = {
  source: "n2yo",
  enabled: () => Boolean(process.env.N2YO_API_KEY),
  async fetch(): Promise<GlobeEntity[]> {
    // Optional fallback adapter. Keep disabled without credentials.
    return [];
  },
};

