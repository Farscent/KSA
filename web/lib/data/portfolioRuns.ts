/**
 * Server-only reads of saved portfolio-wide Run Analyst summaries
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
  id: string;
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
    .select("id, as_of, symbols, sections, package, provenance, steps, credits_used, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PortfolioRunRow>();

  if (error) throw new Error(`portfolio_runs read failed: ${error.message}`);
  return data ?? null;
}

/** One row of the history list: enough to describe a run without its report body. */
export interface PortfolioRunListItem {
  id: string;
  as_of: string;
  symbols: string[];
  credits_used: number | null;
  duration_ms: number | null;
  created_at: string;
}

/** Saved portfolio runs, newest first. Light columns only — see `fetchPortfolioRunById` for the report. */
export async function fetchPortfolioRunList(limit = 50): Promise<PortfolioRunListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_runs")
    .select("id, as_of, symbols, credits_used, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<PortfolioRunListItem[]>();

  if (error) throw new Error(`portfolio_runs list read failed: ${error.message}`);
  return data ?? [];
}

/** One saved portfolio run with its full report, or null if the id matches nothing the caller owns. */
export async function fetchPortfolioRunById(id: string): Promise<PortfolioRunRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_runs")
    .select("id, as_of, symbols, sections, package, provenance, steps, credits_used, duration_ms, created_at")
    .eq("id", id)
    .maybeSingle<PortfolioRunRow>();

  if (error) throw new Error(`portfolio_runs read failed: ${error.message}`);
  return data ?? null;
}
