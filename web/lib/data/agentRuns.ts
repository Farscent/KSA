/**
 * Server-only reads of saved Run Analyst reports (see supabase/migrations/0003_agent_runs.sql).
 * Same reads-only seam as `lib/data/results.ts` — never calls the Sectors API,
 * never imported from a "use client" file (it reads `next/headers` via
 * `lib/supabase/server.ts`).
 */
import { createClient } from "@/lib/supabase/server";
import type { Verdict } from "@/lib/verdict";
import type { ReportSection } from "@/lib/llm/report";
import type { StepTrace } from "@/lib/agent/package";
import type { ProvenanceEntry } from "@/lib/sectors/cache";

export interface AgentRunRow {
  symbol: string;
  trade_date: string;
  verdict: Verdict;
  paragraphs: string[];
  grounded_in: string[];
  created_at: string;
  /** Null for rows written before the sectioned report landed (migration
   * 0006); those still render from `paragraphs`. */
  sections: ReportSection[] | null;
  steps: StepTrace[] | null;
  provenance: ProvenanceEntry[] | null;
  credits_used: number | null;
  duration_ms: number | null;
}

/**
 * Latest saved report per symbol, for exactly the symbols the caller holds.
 * A symbol with no row yet (analyst hasn't run on it) is simply absent from
 * the map — callers render that as "not run yet", never a guessed verdict.
 */
export async function fetchAgentRuns(symbols: string[]): Promise<Map<string, AgentRunRow>> {
  if (symbols.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select(
      "symbol, trade_date, verdict, paragraphs, grounded_in, created_at, sections, steps, provenance, credits_used, duration_ms"
    )
    .in("symbol", symbols)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`agent_runs read failed: ${error.message}`);

  const map = new Map<string, AgentRunRow>();
  for (const row of (data ?? []) as AgentRunRow[]) {
    if (!map.has(row.symbol)) map.set(row.symbol, row); // rows are newest-first
  }
  return map;
}

/**
 * Every saved run per symbol, newest first, capped at `limit` per symbol.
 * Powers the "Past runs" picker on the symbol page — `fetchAgentRuns` above
 * remains the "latest per symbol" read every other component relies on.
 */
export async function fetchAgentRunHistory(symbols: string[], limit = 10): Promise<Map<string, AgentRunRow[]>> {
  if (symbols.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select(
      "symbol, trade_date, verdict, paragraphs, grounded_in, created_at, sections, steps, provenance, credits_used, duration_ms"
    )
    .in("symbol", symbols)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`agent_runs history read failed: ${error.message}`);

  const map = new Map<string, AgentRunRow[]>();
  for (const row of (data ?? []) as AgentRunRow[]) {
    const existing = map.get(row.symbol);
    if (existing) {
      if (existing.length < limit) existing.push(row);
    } else {
      map.set(row.symbol, [row]);
    }
  }
  return map;
}
