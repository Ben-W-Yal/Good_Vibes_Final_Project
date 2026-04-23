import type { SourceAdapter } from "./provider";
import type { GlobeEntity } from "../types/globe";

export const aisstreamAdapter: SourceAdapter = {
  source: "aisstream",
  enabled: () => Boolean(process.env.AISSTREAM_API_KEY),
  async fetch(): Promise<GlobeEntity[]> {
    // TODO: Implement server-side WebSocket consumer and rebroadcast channel.
    return [];
  },
};

