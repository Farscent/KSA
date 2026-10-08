/**
 * Server-only read of the latest saved portfolio-wide Run Analyst summary
 * (see supabase/migrations/0007_portfolio_runs.sql). Same read-only seam as
 * lib/data/agentRuns.ts — never calls the Sectors API, never imported from a
 * "use client" file.
 */
import { createClient } from "@/lib/supabase/server";
import type { ReportSection } from "@/lib/llm/portfolioReport";
import type { PortfolioPackage } from "@/lib/agent/portfolio";
import type { StepTrace } from "@/lib/agent/package";
import type { ProvenanceEntry } from "@/lib/sectors/cache";

export interface PortfolioRunRow {
  as_of: string;
  symbols: string[];
  sections: ReportSection[];
  package: PortfolioPackage;
  provenance: ProvenanceEntry[] | null;
  steps: StepTrace[] | null;
  credits_used: number | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * The single most recent portfolio run, or null if Run Analyst has never
 * produced one — callers render that as "no summary yet", never a guess.
 */
export async function fetchLatestPortfolioRun(): Promise<PortfolioRunRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_runs")
    .select("as_of, symbols, sections, package, provenance, steps, credits_used, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PortfolioRunRow>();

  if (error) throw new Error(`portfolio_runs read failed: ${error.message}`);
  return data ?? null;
}

/**
 * Every saved portfolio-wide summary, newest first, capped at `limit`.
 * Powers the dashboard's "Past runs" picker.
 */
export async function fetchPortfolioRunHistory(limit = 10): Promise<PortfolioRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_runs")
    .select("as_of, symbols, sections, package, provenance, steps, credits_used, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<PortfolioRunRow[]>();

  if (error) throw new Error(`portfolio_runs history read failed: ${error.message}`);
  return data ?? [];
}
