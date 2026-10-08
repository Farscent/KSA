import "server-only";
import { createHash } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { sectorsFetch, SectorsError } from "@/lib/sectors/client";

/**
 * Cache-first access to the Sectors API, plus the per-run credit ledger.
 *
 * This is what makes a live demo affordable: the first Run Analyst pass over a
 * symbol spends credits, every later pass over the same symbol spends zero.
 * See supabase/migrations/0005_sectors_cache.sql for the table and the RLS
 * trade-off it documents.
 */

/** Default freshness. Company fundamentals move on a quarterly cadence, so a
 * week-old `company/report` is still the same report; news is refreshed far
 * more often by its caller. */
const DEFAULT_TTL_DAYS = 7;

export interface ProvenanceEntry {
  endpoint: string;
  params: Record<string, string>;
  credits: number;
  cached: boolean;
  fetched_at: string;
}

export interface FetchResult {
  payload: unknown;
  provenance: ProvenanceEntry;
}

/**
 * Stable hash of the request parameters. Keys are sorted so that
 * `{a, b}` and `{b, a}` are the same cache entry rather than two.
 */
export function paramsHash(endpoint: string, params: Record<string, string>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))));
  return createHash("sha256").update(`${endpoint}\n${canonical}`).digest("hex");
}

/**
 * Enforces a hard credit ceiling for one Run Analyst pass.
 *
 * A run that would exceed the ceiling stops spending and marks its remaining
 * steps skipped, rather than silently returning a partial report that looks
 * complete. The ceiling is per symbol; see `SECTORS_RUN_CREDIT_CEILING`.
 */
export class CreditLedger {
  readonly ceiling: number;
  private spent = 0;
  private readonly entries: ProvenanceEntry[] = [];

  constructor(ceiling?: number) {
    const configured = Number(process.env.SECTORS_RUN_CREDIT_CEILING);
    this.ceiling = ceiling ?? (Number.isFinite(configured) && configured > 0 ? configured : 25);
  }

  get used(): number {
    return this.spent;
  }

  get provenance(): ProvenanceEntry[] {
    return [...this.entries];
  }

  /** Would spending `credits` more breach the ceiling? */
  wouldExceed(credits: number): boolean {
    return this.spent + credits > this.ceiling;
  }

  record(entry: ProvenanceEntry): void {
    this.spent += entry.credits;
    this.entries.push(entry);
  }
}

export class CreditCeilingError extends Error {
  readonly reason_code = "CREDIT_CEILING_REACHED" as const;
  constructor(ceiling: number) {
    super(`Run credit ceiling of ${ceiling} reached; remaining research steps were skipped.`);
    this.name = "CreditCeilingError";
  }
}

interface CacheRow {
  payload: unknown;
  credits: number;
  fetched_at: string;
}

function isFresh(fetchedAt: string, ttlDays: number): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < ttlDays * 86_400_000;
}

/**
 * Read `endpoint` from cache, falling back to a live fetch.
 *
 * `credits` is what this call costs on a miss, declared by the caller from
 * AGENTS.md's verified per-endpoint table — never guessed here, because only
 * the caller knows how many `sections=` it asked for.
 *
 * A cache *read* failure is not fatal: we treat it as a miss and fetch. A
 * cache *write* failure is not fatal either — the caller already has its
 * payload, and the only cost is that the next run pays again.
 */
export async function getOrFetch(
  endpoint: string,
  params: Record<string, string>,
  { credits, ledger, ttlDays = DEFAULT_TTL_DAYS }: { credits: number; ledger: CreditLedger; ttlDays?: number }
): Promise<FetchResult> {
  const hash = paramsHash(endpoint, params);
  const supabase = await createClient();

  const { data } = await supabase
    .from("sectors_cache")
    .select("payload, credits, fetched_at")
    .eq("endpoint", endpoint)
    .eq("params_hash", hash)
    .maybeSingle<CacheRow>();

  if (data && isFresh(data.fetched_at, ttlDays)) {
    const provenance: ProvenanceEntry = {
      endpoint,
      params,
      credits: 0, // a hit costs nothing; data.credits is what it cost originally
      cached: true,
      fetched_at: data.fetched_at,
    };
    ledger.record(provenance);
    return { payload: data.payload, provenance };
  }

  // Check the ceiling only when we are actually about to spend. A cache hit
  // must never be refused for budget reasons.
  if (ledger.wouldExceed(credits)) throw new CreditCeilingError(ledger.ceiling);

  const payload = await sectorsFetch(endpoint, params);
  const fetched_at = new Date().toISOString();

  const { error } = await supabase
    .from("sectors_cache")
    .upsert({ endpoint, params_hash: hash, params, payload, credits, fetched_at }, { onConflict: "endpoint,params_hash" });
  if (error) console.warn(`[sectors] cache write failed for ${endpoint}: ${error.message}`);

  const provenance: ProvenanceEntry = { endpoint, params, credits, cached: false, fetched_at };
  ledger.record(provenance);
  return { payload, provenance };
}

export { SectorsError };
