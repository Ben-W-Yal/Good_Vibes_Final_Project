import { z } from "zod";
import { withCache } from "../lib/cache";
import type { SourceAdapter } from "./provider";
import type { GlobeEntity, SourceQuery } from "../types/globe";

const OAUTH_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

/** https://acleddata.com/api-documentation/elements-acleds-api — common OAuth/API failures */
function oauthErrorMessage(raw: unknown, status: number): string {
  if (typeof raw !== "object" || raw === null) return `ACLED OAuth failed: ${status}`;
  const o = raw as Record<string, unknown>;
  if (typeof o.error_description === "string") return o.error_description;
  if (typeof o.message === "string") return o.message;
  if (o.error === "invalid_grant") {
    return "invalid_grant — wrong email/password or account not allowed for OAuth (see ACLED API auth).";
  }
  if (typeof o.error === "string") return o.error;
  return `ACLED OAuth failed: ${status}`;
}

function hintAcledAccessMessage(message: string): string {
  const m = message.trim();
  if (/access denied/i.test(m)) {
    return `${m} — Ensure your myACLED user is in the API access group (ACLED API documentation).`;
  }
  if (/consent/i.test(m)) {
    return `${m} — Log in at acleddata.com and accept required consent.`;
  }
  if (/required fields/i.test(m)) {
    return `${m} — Complete required fields on your myACLED profile.`;
  }
  return m;
}

function readBodyMessage(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return JSON.stringify(raw).slice(0, 400);
  const o = raw as Record<string, unknown>;
  if (typeof o.message === "string") return hintAcledAccessMessage(o.message);
  if (Array.isArray(o.message) && o.message.length > 0) {
    return hintAcledAccessMessage(String(o.message[0]));
  }
  return JSON.stringify(raw).slice(0, 400);
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
});

const readResponseSchema = z
  .object({
    status: z.union([z.coerce.number(), z.string()]).optional(),
    success: z.boolean().optional(),
    count: z.number().optional(),
    data: z.array(z.record(z.unknown())).optional(),
    messages: z.array(z.unknown()).optional(),
    data_query_restrictions: z
      .object({
        date_recency: z
          .object({
            date: z.string().optional(),
            quantity: z.number().optional(),
            unit: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

/** Extract the embargo cutoff the account is restricted to (YYYY-MM-DD) if present. */
function extractEmbargoDate(parsed: z.infer<typeof readResponseSchema>): string | null {
  const d = parsed.data_query_restrictions?.date_recency?.date;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return null;
}

/** ACLED JSON uses status 0, 200, or omits it; treat non-finite / unknown as OK unless success === false. */
function acledJsonIndicatesError(parsed: z.infer<typeof readResponseSchema>): boolean {
  if (parsed.success === false) return true;
  const s = parsed.status;
  if (s === undefined || s === null) return false;
  const n = typeof s === "number" ? s : Number(String(s).trim());
  if (!Number.isFinite(n)) return false;
  if (n === 0 || n === 200) return false;
  if (n >= 200 && n < 300) return false;
  return n < 200 || n >= 400;
}

function flattenAcledRow(row: Record<string, unknown>): Record<string, unknown> {
  const attrs = row.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    return { ...row, ...(attrs as Record<string, unknown>) };
  }
  return row;
}

/** In-memory token cache (server process). */
let tokenCache: {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
} | null = null;

function cacheToken(j: z.infer<typeof tokenResponseSchema>): void {
  const ttlSec = j.expires_in ?? 3600;
  tokenCache = {
    accessToken: j.access_token,
    expiresAt: Date.now() + Math.max(120, ttlSec - 120) * 1000,
    refreshToken: j.refresh_token,
  };
}

async function fetchPasswordToken(): Promise<string> {
  const email = process.env.ACLED_EMAIL?.trim();
  const password = process.env.ACLED_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("ACLED_EMAIL and ACLED_PASSWORD are required");
  }

  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: email,
      password,
      client_id: "acled",
    }),
  });

  const raw: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(oauthErrorMessage(raw, res.status));
  }

  const parsed = tokenResponseSchema.parse(raw);
  cacheToken(parsed);
  return parsed.access_token;
}

async function fetchRefreshToken(refreshToken: string): Promise<string> {
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "acled",
    }),
  });

  const raw: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    tokenCache = null;
    return fetchPasswordToken();
  }

  const parsed = tokenResponseSchema.parse(raw);
  cacheToken(parsed);
  return parsed.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  if (tokenCache?.refreshToken) {
    return fetchRefreshToken(tokenCache.refreshToken);
  }
  return fetchPasswordToken();
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

/** ACLED needs a wide enough window or many regions return 0 rows (sparse in 24h). */
const MIN_RANGE_DAYS = 14;

function widenRange(fromIso: string, toIso: string): { from: string; to: string } {
  const toT = new Date(toIso).getTime();
  let fromT = new Date(fromIso).getTime();
  const minMs = MIN_RANGE_DAYS * 86_400_000;
  if (toT - fromT < minMs) {
    fromT = toT - minMs;
  }
  return { from: new Date(fromT).toISOString(), to: new Date(toT).toISOString() };
}

/** Map UI region tab to ACLED filters. Broad areas (Africa/Asia/…) rely on date range only — avoids wrong region codes. */
function regionFilters(region?: string): { country?: string; region?: string } {
  if (!region?.trim()) return {};
  const r = region.trim().toLowerCase();
  if (r === "ukraine") return { country: "Ukraine" };
  if (r === "middle east") return { region: "11" };
  if (r === "europe") return { region: "12" };
  return {};
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function pick(row: Record<string, unknown>, ...aliases: string[]): unknown {
  for (const a of aliases) {
    if (a in row) return row[a];
    const hit = Object.keys(row).find((k) => k.toLowerCase() === a.toLowerCase());
    if (hit) return row[hit];
  }
  return undefined;
}

function rowToEntity(row: Record<string, unknown>): GlobeEntity | null {
  const id = str(pick(row, "event_id_cnty"));
  const lat = num(pick(row, "latitude"));
  const lon = num(pick(row, "longitude"));
  if (!id || lat == null || lon == null) return null;

  const eventDate = str(pick(row, "event_date")) ?? new Date().toISOString().slice(0, 10);
  const notes = str(pick(row, "notes")) ?? "";
  const sub = str(pick(row, "sub_event_type")) ?? str(pick(row, "event_type")) ?? "Event";
  const country = str(pick(row, "country")) ?? "";
  const location = str(pick(row, "location")) ?? "";
  const fatalities = num(pick(row, "fatalities")) ?? 0;
  const geoPrec = num(pick(row, "geo_precision"));

  const title = notes.length > 120 ? `${notes.slice(0, 117)}…` : notes || sub;
  const confidence =
    fatalities >= 10 ? 0.88 : fatalities >= 3 ? 0.75 : geoPrec === 1 ? 0.72 : 0.6;

  return {
    id,
    source: "acled",
    category: "conflict",
    subcategory: sub,
    label: title || sub,
    lat,
    lon,
    timestamp: `${eventDate}T12:00:00.000Z`,
    confidence,
    metadata: {
      notes,
      country,
      location,
      event_type: str(pick(row, "event_type")),
      sub_event_type: str(pick(row, "sub_event_type")),
      actor1: str(pick(row, "actor1")),
      actor2: str(pick(row, "actor2")),
      fatalities,
      region: str(pick(row, "region")),
      sourceUrl: "https://acleddata.com/",
    },
  };
}

export const acledAdapter: SourceAdapter = {
  source: "acled",
  enabled() {
    return Boolean(process.env.ACLED_EMAIL?.trim() && process.env.ACLED_PASSWORD?.trim());
  },

  async fetch(query?: SourceQuery): Promise<GlobeEntity[]> {
    if (!this.enabled()) return [];

    const toIso = query?.to ?? new Date().toISOString();
    const fromIso = query?.from ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { from: fromWide, to: toWide } = widenRange(fromIso, toIso);
    const from = ymd(fromWide);
    const to = ymd(toWide);
    const maxRows = Math.min(200, Math.max(20, query?.limit ?? 100));

    const regionKey = query?.region?.trim() ?? "";
    const rf = regionFilters(regionKey || undefined);
    const cacheKey = `acled:v4:${from}:${to}:${regionKey || "global"}:${maxRows}`;

    return withCache(cacheKey, 120_000, async () => {
      const token = await getAccessToken();

      const baseFields = [
        "event_id_cnty",
        "event_date",
        "event_type",
        "sub_event_type",
        "country",
        "location",
        "latitude",
        "longitude",
        "notes",
        "fatalities",
        "geo_precision",
        "actor1",
        "actor2",
        "region",
      ].join("|");

      async function readOnceRaw(
        extra: URLSearchParams,
      ): Promise<z.infer<typeof readResponseSchema>> {
        const res = await fetch(`${READ_URL}?${extra.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        const raw: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(`ACLED HTTP ${res.status}: ${readBodyMessage(raw)}`);
        }

        const parsed = readResponseSchema.parse(raw);
        if (acledJsonIndicatesError(parsed)) {
          const st = parsed.status;
          const msg = Array.isArray(parsed.messages)
            ? parsed.messages.map(String).join("; ")
            : `status=${String(st)}`;
          throw new Error(`ACLED rejected: ${hintAcledAccessMessage(msg)}`);
        }
        return parsed;
      }

      async function readOnce(
        extra: URLSearchParams,
      ): Promise<{ rows: Record<string, unknown>[]; embargoDate: string | null }> {
        const parsed = await readOnceRaw(extra);
        const rows = (parsed.data ?? []).map((r) => flattenAcledRow(r));
        return { rows, embargoDate: extractEmbargoDate(parsed) };
      }

      function buildBetweenParams(fromYmd: string, toYmd: string): URLSearchParams {
        const p = new URLSearchParams();
        p.set("_format", "json");
        p.set("event_date", `${fromYmd}|${toYmd}`);
        p.set("event_date_where", "BETWEEN");
        p.set("fields", baseFields);
        p.set("limit", String(maxRows));
        if (rf.country) p.set("country", rf.country);
        if (rf.region) p.set("region", rf.region);
        if (query?.keyword?.trim()) p.set("notes", query.keyword.trim());
        return p;
      }

      function shiftWindowToEmbargo(embargo: string): { from: string; to: string } {
        // Anchor `to` at the embargo cutoff and keep the same window length (min MIN_RANGE_DAYS).
        const toT = new Date(`${embargo}T23:59:59Z`).getTime();
        const fromT = new Date(from).getTime();
        const origToT = new Date(to).getTime();
        const spanMs = Math.max(MIN_RANGE_DAYS * 86_400_000, origToT - fromT);
        return { from: ymd(new Date(toT - spanMs).toISOString()), to: ymd(new Date(toT).toISOString()) };
      }

      let rows: Record<string, unknown>[] = [];
      let embargoDate: string | null = null;

      try {
        const first = await readOnce(buildBetweenParams(from, to));
        rows = first.rows;
        embargoDate = first.embargoDate;

        // Account is embargoed (e.g. 12-month tier) and our window was too recent → retry shifted.
        if (rows.length === 0 && embargoDate && embargoDate < to) {
          const shifted = shiftWindowToEmbargo(embargoDate);
          console.info(
            `[acled] account embargoed at ${embargoDate}; retrying window ${shifted.from}..${shifted.to}`,
          );
          const second = await readOnce(buildBetweenParams(shifted.from, shifted.to));
          rows = second.rows;
        }
      } catch (e1) {
        console.warn("[acled] BETWEEN query failed, retrying with year range:", e1);
        const y = new Date().getFullYear();
        const p2 = new URLSearchParams();
        p2.set("_format", "json");
        p2.set("year", `${y - 1}|${y}`);
        p2.set("year_where", "BETWEEN");
        p2.set("fields", baseFields);
        p2.set("limit", String(maxRows));
        if (rf.country) p2.set("country", rf.country);
        if (rf.region) p2.set("region", rf.region);
        if (query?.keyword?.trim()) p2.set("notes", query.keyword.trim());
        try {
          const r2 = await readOnce(p2);
          rows = r2.rows;
        } catch (e2) {
          console.warn("[acled] year BETWEEN failed, retrying single year:", e2);
          const p3 = new URLSearchParams();
          p3.set("_format", "json");
          p3.set("year", String(y));
          p3.set("fields", baseFields);
          p3.set("limit", String(maxRows));
          if (rf.country) p3.set("country", rf.country);
          if (rf.region) p3.set("region", rf.region);
          if (query?.keyword?.trim()) p3.set("notes", query.keyword.trim());
          const r3 = await readOnce(p3);
          rows = r3.rows;
        }
      }

      if (rows.length === 0) {
        const hint = embargoDate
          ? `account embargo cutoff = ${embargoDate}. Your tier only allows events at least 12 months old.`
          : "check API tier, region, or try Filters → Time range (uses last 14+ days server-side for ACLED).";
        console.warn(`[acled] 0 rows — ${hint}`);
      }

      const out: GlobeEntity[] = [];
      for (const row of rows) {
        const g = rowToEntity(row);
        if (g) out.push(g);
        if (out.length >= maxRows) break;
      }
      return out;
    });
  },
};
