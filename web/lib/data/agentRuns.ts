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
import type { EvidenceCoverage } from "@/lib/agent/coverage";
import type { ServeComponentsRecord } from "@/lib/contract/types";
import type { PeerMetrics } from "@/lib/agent/metrics";
import type { Peers, ResearchBlock } from "@/lib/research/types";

const AGENT_RUN_COLUMNS =
  "symbol, run_id, trade_date, verdict, paragraphs, grounded_in, created_at, sections, steps, provenance, credits_used, duration_ms, coverage:package->coverage, identity:package->identity, flow_components:package->flow->components, lots:package->position->lots->value, peers:package->peers, peer_metrics:package->peer_metrics";

export interface AgentRunRow {
  /** The portfolio run this report was made in; null for single-symbol runs and older rows. */
  run_id: string | null;
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
  /** Read out of the saved package; null for runs saved before it existed. */
  coverage: EvidenceCoverage | null;
  /** Company profile block from the saved package; its `data` is null when unavailable. */
  /** The scored components as this run saw them; null for rows saved before the package carried them. */
  flow_components: ServeComponentsRecord | null;
  /** Lots held when this run was made; null if the holding was not found then. */
  lots: number | null;
  /** Peer block and screen as this run saw them; null for runs saved before the package carried them. */
  peers: ResearchBlock<Peers> | null;
  peer_metrics: PeerMetrics | null;
  /** The broker-flow series as this run saw it. Only selected for past-run snapshots. */
  flow_series?: unknown[] | null;
  identity: { data: { market_cap: number | null; sector: string | null; sub_sector: string | null; listing_date: string | null } | null } | null;
}

/**
 * Latest saved report per symbol, for exactly the symbols the caller holds.
 * A symbol with no row yet (analyst hasn't run on it) is simply absent from
 * the map — callers render that as "not run yet", never a guessed verdict.
 */
export async function fetchAgentRuns(symbols: string[]): Promise<Map<string, AgentRunRow>> {
  if (symbols.length === 0) return new Map();

  // One limit-1 read per symbol rather than every saved row: history grows
  // with each run, and only the newest report per symbol is needed here.
  const supabase = await createClient();
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select(AGENT_RUN_COLUMNS)
        .eq("symbol", symbol)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`agent_runs read failed: ${error.message}`);
      return data as unknown as AgentRunRow | null;
    })
  );

  const map = new Map<string, AgentRunRow>();
  for (const row of results) if (row) map.set(row.symbol, row);
  return map;
}

/**
 * The fields history list pages need — status and verdict, no report bodies.
 * Keeps `/history` cheap: a run list never downloads every saved report.
 */
export interface AgentRunLite {
  symbol: string;
  run_id: string;
  trade_date: string;
  verdict: Verdict;
  created_at: string;
  flow_components: ServeComponentsRecord | null;
  lots: number | null;
}

const AGENT_RUN_LITE_COLUMNS =
  "symbol, run_id, trade_date, verdict, created_at, flow_components:package->flow->components, lots:package->position->lots->value";

/** Per-symbol reports for several portfolio runs at once, grouped by run id. */
export async function fetchAgentRunsLite(runIds: string[]): Promise<Map<string, AgentRunLite[]>> {
  if (runIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_runs").select(AGENT_RUN_LITE_COLUMNS).in("run_id", runIds);
  if (error) throw new Error(`agent_runs list read failed: ${error.message}`);

  const map = new Map<string, AgentRunLite[]>();
  for (const row of (data ?? []) as unknown as AgentRunLite[]) {
    const existing = map.get(row.run_id);
    if (existing) existing.push(row);
    else map.set(row.run_id, [row]);
  }
  return map;
}

/** Every per-symbol report saved under one portfolio run, in symbol order. */
export async function fetchAgentRunsForRun(runId: string): Promise<AgentRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select(AGENT_RUN_COLUMNS)
    .eq("run_id", runId)
    .order("symbol", { ascending: true });
  if (error) throw new Error(`agent_runs run read failed: ${error.message}`);
  return (data ?? []) as unknown as AgentRunRow[];
}

/** One symbol's report inside one portfolio run, or null if that run never covered it. */
export async function fetchAgentRunForRun(runId: string, symbol: string): Promise<AgentRunRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select(`${AGENT_RUN_COLUMNS}, flow_series:package->flow->series`)
    .eq("run_id", runId)
    .eq("symbol", symbol)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`agent_runs run/symbol read failed: ${error.message}`);
  return (data as unknown as AgentRunRow | null) ?? null;
}
