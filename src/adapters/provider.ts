import type { GlobeEntity, SourceQuery } from "../types/globe";

export interface SourceAdapter {
  source: GlobeEntity["source"];
  enabled(): boolean;
  fetch(query?: SourceQuery): Promise<GlobeEntity[]>;
}

