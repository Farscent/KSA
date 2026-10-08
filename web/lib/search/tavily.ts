import "server-only";

/**
 * The only place the Next server talks to a web-search provider (Tavily).
 *
 * Used for macro and policy headlines only. Callers go through
 * `getOrFetch` in lib/sectors/cache.ts with `tavilySearch` as the fetcher, so
 * a repeated run over the same review date costs no searches. The provider's
 * prose is never stored or shown: lib/research/project.ts keeps title, URL
 * and date and drops the snippet.
 */

const SEARCH_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 10_000;

export type SearchReasonCode =
  | "NO_SEARCH_PROVIDER"
  | "SEARCH_AUTH"
  | "SEARCH_RATE_LIMIT"
  | "SEARCH_TIMEOUT"
  | "SEARCH_FAILED"
  | "MALFORMED_RESPONSE";

export class SearchError extends Error {
  readonly reason_code: SearchReasonCode;

  constructor(reason_code: SearchReasonCode, message: string) {
    super(message);
    this.name = "SearchError";
    this.reason_code = reason_code;
  }
}

export function searchConfigured(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

/**
 * One news search inside a date window. `params` is the cache key's parameter
 * set: `{query, start_date, end_date}`.
 */
export async function tavilySearch(_path: string, params: Record<string, string>): Promise<unknown> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new SearchError("NO_SEARCH_PROVIDER", "TAVILY_API_KEY is not set.");
  if (key !== key.trim() || !/^[\x21-\x7e]+$/.test(key)) {
    throw new SearchError("SEARCH_AUTH", "TAVILY_API_KEY contains invalid characters.");
  }

  let response: Response;
  try {
    response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query,
        topic: "news",
        start_date: params.start_date,
        end_date: params.end_date,
        max_results: 8,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new SearchError(timedOut ? "SEARCH_TIMEOUT" : "SEARCH_FAILED", timedOut ? "Search timed out." : "Could not reach the search provider.");
  }

  console.info(`[search] tavily ${response.status}`);
  if (response.status === 401 || response.status === 403) throw new SearchError("SEARCH_AUTH", "The search provider rejected the API key.");
  if (response.status === 429 || response.status === 432 || response.status === 433) {
    throw new SearchError("SEARCH_RATE_LIMIT", "Search quota or rate limit reached.");
  }
  if (!response.ok) throw new SearchError("SEARCH_FAILED", `Search provider returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new SearchError("MALFORMED_RESPONSE", "Search provider returned a body that is not JSON.");
  }
}
