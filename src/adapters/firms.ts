import type { SourceAdapter } from "./provider";
import type { GlobeEntity } from "../types/globe";

export const firmsAdapter: SourceAdapter = {
  source: "firms",
  enabled: () => Boolean(process.env.FIRMS_API_KEY),
  async fetch(): Promise<GlobeEntity[]> {
    // TODO: Implement using NASA FIRMS official data access method and docs.
    return [];
  },
};

