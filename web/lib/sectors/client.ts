import "server-only";

/**
 * The only place the Next server talks to the Sectors API.
 *
 * CLAUDE.md's architecture rule 1 is amended for this file and nothing else:
 * the *browser* never calls Sectors; the Next *server* may, through this
 * cached, credit-metered client. Bulk historical ingestion still belongs to
 * the Python batch (`sectors/`), which is why nothing here fetches a window of
 * broker summaries — that is `sectors/flow.py`'s job.
 *
 * Transport rules mirror `sectors/registry.py`, which already does this
 * correctly on the Python side. Keep the two in step.
 */

const BASE_URL = "https://api.sectors.app/v2";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/**
 * Statuses worth retrying. Deliberately excludes 404: per AGENTS.md's verified
 * billing table a 404 still costs a credit because the lookup ran, so retrying
 * one burns the budget for a result that will not change. 400/401/403/429/5xx
 * are free, so backing off on 429/5xx costs nothing.
 */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export type SectorsReasonCode =
  | "MISSING_API_KEY"
  | "INVALID_API_KEY_FORMAT"
  | "UPSTREAM_AUTH"
  | "UPSTREAM_NOT_FOUND"
  | "UPSTREAM_RATE_LIMIT"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_REDIRECT"
  | "TIMEOUT"
  | "TRANSPORT_FAILED"
  | "MALFORMED_RESPONSE";

export class SectorsError extends Error {
  readonly reason_code: SectorsReasonCode;
  readonly status: number | null;

  constructor(reason_code: SectorsReasonCode, message: string, status: number | null = null) {
    super(message);
    this.name = "SectorsError";
    this.reason_code = reason_code;
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.SECTORS_API_KEY;
  if (!key) {
    throw new SectorsError("MISSING_API_KEY", "SECTORS_API_KEY is not set — research steps cannot run.");
  }
  // Header values must be printable ASCII with no surrounding whitespace, or
  // fetch throws an opaque TypeError far from the actual cause.
  if (key !== key.trim() || !/^[\x21-\x7e]+$/.test(key)) {
    throw new SectorsError("INVALID_API_KEY_FORMAT", "SECTORS_API_KEY contains invalid characters.");
  }
  return key;
}

/** `bbca.jk` / `BBCA.JK` -> `BBCA`, matching the Python side's normalisation. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.JK$/, "");
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${BASE_URL}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One GET against Sectors, returning parsed JSON.
 *
 * Never logs the key, the query string or the body — only endpoint, status and
 * duration, per AGENTS.md. Callers are expected to go through
 * `lib/sectors/cache.ts` rather than calling this directly, so that a repeated
 * run costs no credits.
 */
export async function sectorsFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = apiKey();
  const url = buildUrl(path, params);
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: key, Accept: "application/json" },
        // No `Bearer` prefix: Sectors expects the raw key.
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // A redirect would forward the Authorization header to whatever host
        // the response names. Refuse instead of following.
        redirect: "manual",
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new SectorsError(
          timedOut ? "TIMEOUT" : "TRANSPORT_FAILED",
          timedOut ? `Sectors request timed out after ${TIMEOUT_MS}ms.` : "Could not reach the Sectors API."
        );
      }
      await sleep(2 ** attempt * 1000);
      continue;
    }

    lastStatus = response.status;
    console.info(`[sectors] ${path} ${response.status} ${Date.now() - started}ms`);

    if (response.status >= 300 && response.status < 400) {
      throw new SectorsError("UPSTREAM_REDIRECT", "Sectors returned a redirect; not following it.", response.status);
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new SectorsError("MALFORMED_RESPONSE", "Sectors returned a body that is not JSON.", response.status);
      }
    }
    if (response.status === 404) {
      throw new SectorsError("UPSTREAM_NOT_FOUND", "Sectors has no data for that request.", 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new SectorsError("UPSTREAM_AUTH", "Sectors rejected the API key.", response.status);
    }
    if (!RETRY_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS - 1) break;

    const retryAfter = Number(response.headers.get("Retry-After"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
  }

  if (lastStatus === 429) {
    throw new SectorsError("UPSTREAM_RATE_LIMIT", "Sectors rate limit reached.", 429);
  }
  throw new SectorsError("UPSTREAM_ERROR", `Sectors returned HTTP ${lastStatus}.`, lastStatus);
}
