import { z, type ZodType } from "zod";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        await sleep(300 * 2 ** i);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(300 * 2 ** i);
    }
  }
  throw lastErr ?? new Error("Network request failed after retries");
}

export async function fetchJsonValidated<T>(
  input: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithRetry(input, init);
  if (!res.ok) {
    throw new Error(`Upstream request failed: ${res.status}`);
  }
  const payload: unknown = await res.json();
  return schema.parse(payload);
}

export const envelopeSchema = z.object({
  data: z.unknown().optional(),
});

