import type { SourceAdapter } from "./provider";
import type { GlobeEntity } from "../types/globe";

export const celestrakAdapter: SourceAdapter = {
  source: "celestrak",
  enabled: () => true,
  async fetch(): Promise<GlobeEntity[]> {
    // TODO: Implement against official CelesTrak GP/OMM feeds required by your deployment.
    return [];
  },
};

