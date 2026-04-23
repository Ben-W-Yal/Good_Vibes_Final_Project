declare module "@flightradar24/fr24sdk" {
  export class Client {
    constructor(opts?: { apiToken?: string; apiVersion?: string; timeout?: number });
    live: {
      getLight(params: { bounds: string; limit?: number }): Promise<unknown[]>;
      getFull(params: Record<string, unknown>): Promise<unknown[]>;
    };
    close(): void;
  }
}
