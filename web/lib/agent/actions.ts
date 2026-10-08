"use server";

/**
 * Orchestrates one "Run Analyst" pass for a single symbol.
 *
 * The research pipeline (lib/agent/pipeline.ts) gathers already-computed
 * figures, lib/llm/report.ts narrates them section by section, and the whole
 * thing — report, package, provenance and step trace — is saved to Supabase so
 * it survives a reload and so the follow-up chat can be grounded in exactly
 * what the report was written from.
 *
 * The LLM never sees raw data and never does math: every figure it is shown
 * was computed in lib/agent/metrics.ts first.
 */
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateReport, type ReportSection } from "@/lib/llm/report";
import { answerFollowUp } from "@/lib/llm/narrate";
import { LLM_MODEL } from "@/lib/llm/client";
import { buildPortfolioPackage } from "@/lib/agent/portfolio";
import { generatePortfolioReport } from "@/lib/llm/portfolioReport";
import type { StepTrace, ResearchPackage } from "@/lib/agent/package";
import type { Verdict } from "@/lib/verdict";

export interface AgentReport {
  symbol: string;
  trade_date: string;
  verdict: Verdict;
  /** Legacy flat view, kept so existing callers keep working. */
  paragraphs: string[];
  grounded_in: string[];
  sections: ReportSection[];
  steps: StepTrace[];
  credits_used: number;
  duration_ms: number;
  /** The full research package, so a caller synthesising a portfolio summary
   * across several symbols doesn't need to re-read each one back out of
   * Supabase. */
  package: ResearchPackage;
}

export type RunAnalystResult = { ok: true; report: AgentReport } | { ok: false; error: string };

function explain(message: string): string {
  if (message.includes("OPENROUTER_API_KEY")) return "The analyst isn't configured yet — missing API key.";
  if (message.includes("SECTORS_API_KEY")) return "Research steps need SECTORS_API_KEY set on the server.";
  return message;
}

/**
 * Everything that happens once a research package is fully built: narration,
 * the "nothing writable" honesty check, and the Supabase save. Split out of
 * the pipeline so the streaming route (`lib/agent/stream.ts`) can run it after
 * forwarding the pipeline events that build `pkg` in the first place.
 */
export async function finishAnalystRun(
  pkg: ResearchPackage,
  startedAt: number,
  /** The portfolio run this report belongs to; null for a single-symbol run. */
  runId: string | null = null
): Promise<RunAnalystResult> {
  let report;
  try {
    report = await generateReport(pkg);
  } catch (err) {
    return { ok: false, error: explain(err instanceof Error ? err.message : "Analyst run failed.") };
  }

  // A section counts as written if it has a fact table or prose. A table
  // whose model summary was rejected is still real, measured content.
  const written = report.sections.filter((s) => s.paragraphs.length > 0 || (s.rows?.length ?? 0) > 0);
  if (written.length === 0) {
    // Every section came back unwritable. Report that honestly rather than
    // saving an empty report that looks like a finished one.
    const reasons = [...new Set(report.sections.flatMap((s) => s.reason_codes))].join("; ");
    return { ok: false, error: `No report could be written for ${pkg.symbol} (${reasons || "no figures available"}).` };
  }

  const paragraphs = written.flatMap((s) => s.paragraphs);
  const grounded_in = [...new Set(written.flatMap((s) => s.grounded_in))];
  const duration_ms = Date.now() - startedAt;

  const supabase = await createClient();
  const { error } = await supabase.from("agent_runs").insert({
    symbol: pkg.symbol,
    trade_date: pkg.trade_date,
    verdict: pkg.verdict,
    paragraphs,
    grounded_in,
    sections: report.sections,
    package: pkg,
    provenance: pkg.provenance,
    steps: pkg.steps,
    model: LLM_MODEL,
    credits_used: pkg.credits_used,
    duration_ms,
    run_id: runId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  revalidatePath(`/${pkg.symbol}`);

  return {
    ok: true,
    report: {
      symbol: pkg.symbol,
      trade_date: pkg.trade_date,
      verdict: pkg.verdict,
      paragraphs,
      grounded_in,
      sections: report.sections,
      steps: pkg.steps,
      credits_used: pkg.credits_used,
      duration_ms,
      package: pkg,
    },
  };
}

export type SummarisePortfolioResult =
  | { ok: true; sections: import("@/lib/llm/portfolioReport").ReportSection[]; credits_used: number; duration_ms: number }
  | { ok: false; error: string };

/**
 * Synthesises a portfolio-wide summary over the packages a Run Analyst pass
 * already built — zero extra Sectors credits, since every figure here was
 * already fetched for the per-symbol reports. Saves to `portfolio_runs`.
 */
export async function summarisePortfolio(
  packages: ResearchPackage[],
  windowSessions: number | null,
  /** Same id the per-symbol reports of this pass were saved under. */
  runId: string
): Promise<SummarisePortfolioResult> {
  if (packages.length === 0) {
    return { ok: false, error: "No holdings were successfully reviewed this run." };
  }

  const started = Date.now();
  const pkg = buildPortfolioPackage(packages, windowSessions, 0);

  let report;
  try {
    report = await generatePortfolioReport(pkg);
  } catch (err) {
    return { ok: false, error: explain(err instanceof Error ? err.message : "Portfolio summary failed.") };
  }

  const written = report.sections.filter((s) => s.paragraphs.length > 0 || (s.rows?.length ?? 0) > 0);
  if (written.length === 0) {
    const reasons = [...new Set(report.sections.flatMap((s) => s.reason_codes))].join("; ");
    return { ok: false, error: `No portfolio summary could be written (${reasons || "no figures available"}).` };
  }

  const duration_ms = Date.now() - started;
  const supabase = await createClient();
  const { error } = await supabase.from("portfolio_runs").insert({
    id: runId,
    as_of: pkg.as_of,
    symbols: packages.map((p) => p.symbol),
    sections: report.sections,
    package: { ...pkg, duration_ms },
    provenance: pkg.provenance,
    steps: pkg.steps,
    model: LLM_MODEL,
    credits_used: pkg.credits_used,
    duration_ms,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");

  return { ok: true, sections: report.sections, credits_used: pkg.credits_used, duration_ms };
}

export type PortfolioFollowUpResult = { ok: true; answer: string } | { ok: false; error: string };

/**
 * Answers a follow-up grounded in the saved `portfolio_runs.package` — never
 * rebuilt from fixtures, never re-fetched, so a follow-up cannot cite a
 * figure the portfolio summary never showed.
 */
export async function askPortfolioFollowUp(
  question: string,
  priorThread: { q: string; a: string }[]
): Promise<PortfolioFollowUpResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_runs")
    .select("package")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ package: unknown }>();

  if (error) return { ok: false, error: error.message };
  if (!data?.package) {
    return { ok: false, error: "Run the analyst first — there's no saved portfolio summary to ask about." };
  }

  try {
    const answer = await answerFollowUp(question, data.package, priorThread);
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: explain(err instanceof Error ? err.message : "Could not answer that.") };
  }
}

export type FollowUpResult = { ok: true; answer: string } | { ok: false; error: string };

/**
 * Answers a follow-up grounded in the package the saved report was written
 * from — read back from `agent_runs.package`, never rebuilt from fixtures and
 * never re-fetched. A follow-up therefore cannot cite a figure the report did
 * not have.
 */
export async function askFollowUp(
  symbol: string,
  question: string,
  priorThread: { q: string; a: string }[]
): Promise<FollowUpResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("package")
    .eq("symbol", symbol)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ package: unknown }>();

  if (error) return { ok: false, error: error.message };
  if (!data?.package) {
    return { ok: false, error: `Run the analyst on ${symbol} first — there's no saved report to ask about.` };
  }

  try {
    const answer = await answerFollowUp(question, data.package, priorThread);
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: explain(err instanceof Error ? err.message : "Could not answer that.") };
  }
}
