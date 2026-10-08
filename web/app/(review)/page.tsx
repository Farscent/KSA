"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHoldings } from "@/lib/holdings/store";
import { buildRows, computeTotals, computeValueSeries } from "@/lib/portfolio";
import { RunReviewBar, type RunOutcome } from "@/components/RunReviewBar";
import { TotalsStrip } from "@/components/TotalsStrip";
import { OverviewTable } from "@/components/OverviewTable";
import { PortfolioSparkline } from "@/components/PortfolioSparkline";
import { SectorDonut } from "@/components/SectorDonut";
import { RunProvenanceCard } from "@/components/RunProvenanceCard";
import { PortfolioReportView } from "@/components/PortfolioReportView";
import { AskPanel } from "@/components/AskPanel";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import Link from "next/link";
import { useResults, usePortfolioRun, usePortfolioRunHistory } from "@/lib/data/ResultsProvider";
import { summarisePortfolio } from "@/lib/agent/actions";
import { runAnalystStream } from "@/lib/agent/streamClient";
import type { ReportSection } from "@/lib/llm/portfolioReport";
import type { ResearchPackage } from "@/lib/agent/package";
import type { StepEvent } from "@/lib/agent/pipeline";

type RunState = "notRun" | "running" | "reviewRun";

interface PortfolioSummaryState {
  sections: ReportSection[];
  credits_used: number;
  duration_ms: number;
  symbols: string[];
}

export default function DashboardPage() {
  const router = useRouter();
  const { holdings } = useHoldings();
  const [runState, setRunState] = useState<RunState>("notRun");
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([]);
  const [inFlightSymbol, setInFlightSymbol] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<StepEvent[]>([]);
  const [summary, setSummary] = useState<PortfolioSummaryState | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const { positions, priceHistory, run, agentRunOf } = useResults();
  const savedPortfolioRun = usePortfolioRun();
  const portfolioRunHistory = usePortfolioRunHistory();
  const [selectedPortfolioRunAt, setSelectedPortfolioRunAt] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(holdings, positions), [holdings, positions]);
  const totals = useMemo(() => computeTotals(rows), [rows]);
  const series = useMemo(() => computeValueSeries(holdings, priceHistory), [holdings, priceHistory]);
  const flaggedRows = rows.filter((r) => r.flagged);

  // An explicit "Past runs" selection wins first — otherwise picking an older
  // entry would silently do nothing once a fresh summary exists. Absent a
  // selection, the freshly-run summary takes priority; otherwise the latest
  // saved run, so a reload doesn't lose it. Symbols not held any more are
  // dropped from the per-holding strip rather than left dangling.
  const selectedPastRun = selectedPortfolioRunAt
    ? portfolioRunHistory.find((r) => r.created_at === selectedPortfolioRunAt)
    : savedPortfolioRun;
  const activeSummary = selectedPortfolioRunAt
    ? selectedPastRun
      ? {
          sections: selectedPastRun.sections,
          credits_used: selectedPastRun.credits_used ?? 0,
          duration_ms: selectedPastRun.duration_ms ?? 0,
          symbols: selectedPastRun.symbols,
        }
      : null
    : summary ?? (selectedPastRun
        ? {
            sections: selectedPastRun.sections,
            credits_used: selectedPastRun.credits_used ?? 0,
            duration_ms: selectedPastRun.duration_ms ?? 0,
            symbols: selectedPastRun.symbols,
          }
        : null);
  const summaryHoldingLines = (activeSummary?.symbols ?? [])
    .filter((sym) => holdings.some((h) => h.sym === sym))
    .map((sym) => {
      const agentRun = agentRunOf(sym);
      const flowSection = agentRun?.sections?.find((s) => s.id === "flow_structure");
      return {
        symbol: sym,
        verdict: agentRun?.verdict ?? "Healthy",
        detail: flowSection?.paragraphs[0] ?? "no flow section",
      };
    });

  async function onRun() {
    setRunState("running");
    setOutcomes([]);
    setSummary(null);
    setSummaryError(null);
    setSelectedPortfolioRunAt(null);
    // Sequential, not Promise.all: each symbol's research spends credits
    // against a shared budget, and running ten in parallel also runs ten
    // concurrent Sectors calls straight into the rate limiter.
    const collected: RunOutcome[] = [];
    const packages: ResearchPackage[] = [];
    for (const holding of holdings) {
      setInFlightSymbol(holding.sym);
      setLiveSteps([]);
      const result = await runAnalystStream(holding.sym, (event) => {
        if (event.type !== "step") return;
        setLiveSteps((prev) => {
          const next = prev.filter((s) => s.id !== event.id);
          next.push(event);
          return next;
        });
      });
      collected.push(
        result.ok
          ? {
              symbol: holding.sym,
              ok: true,
              steps: result.report.steps,
              credits_used: result.report.credits_used,
            }
          : { symbol: holding.sym, ok: false, error: result.error }
      );
      if (result.ok) packages.push(result.report.package);
      setOutcomes([...collected]);
    }
    setInFlightSymbol(null);
    setLiveSteps([]);
    setRunState("reviewRun");

    // The synthesis pass: zero extra Sectors credits, reads the packages
    // just built above. It is the point of the button — a portfolio review
    // should produce something about the portfolio, not just per-symbol rows.
    if (packages.length > 0) {
      const result = await summarisePortfolio(packages, run?.window.sessions ?? null);
      if (result.ok) {
        setSummary({
          sections: result.sections,
          credits_used: result.credits_used,
          duration_ms: result.duration_ms,
          symbols: packages.map((p) => p.symbol),
        });
      } else {
        setSummaryError(result.error);
      }
    }

    // Pulls the run(s) just saved into agentRuns/agentRunHistory/portfolioRun/
    // portfolioRunHistory — without this, the dashboard stays on whatever
    // ReviewLayout fetched at initial mount, since staying on this page after
    // a run isn't a navigation and revalidatePath alone only affects the next
    // one. Existing client state (summary, outcomes, etc.) is preserved.
    router.refresh();
  }

  // A signed-in user starts with an empty portfolio: there is no demo
  // portfolio to fall back on, so send them to add one rather than render a
  // dashboard of zeros that looks like real data.
  if (holdings.length === 0) {
    return (
      <>
        <div className="flex flex-col items-start gap-4 px-7 py-12">
          <div className="font-serif text-[22px] text-[var(--color-ink)]">No holdings yet</div>
          <div className="max-w-[560px] text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
            Add the positions you hold and this screen will value them against the batch{"'"}s own daily close
            data, then review each one for structural change in broker trading behaviour.
          </div>
          <Link
            href="/holdings"
            className="rounded-md px-4.5 py-2.5 font-medium text-[12.5px] text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Add your first holding
          </Link>
        </div>
        <DisclaimerFooter />
      </>
    );
  }

  return (
    <>
      {/* The bar now stays mounted after a run so it can show the real step
          trace and every failing symbol; it hides itself when there is
          nothing left to report. */}
      <RunReviewBar
        state={runState}
        onRun={onRun}
        holdingsCount={holdings.length}
        outcomes={outcomes}
        inFlightSymbol={inFlightSymbol ?? undefined}
        liveSteps={liveSteps}
      />

      {runState === "reviewRun" && (
        <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-6.5" style={{ borderColor: "var(--color-line)" }}>
          <div
            className="font-mono text-[11px] uppercase text-[var(--color-muted)]"
            style={{ letterSpacing: "0.1em" }}
          >
            Review run {"·"} {run ? run.trade_date : "no batch run yet"}
          </div>
          <div className="mt-1.5 font-serif text-[22px] text-[var(--color-ink)]">
            {holdings.length} holdings reviewed {"·"}{" "}
            <span style={{ color: "var(--color-accent)" }}>{flaggedRows.length} flagged for review</span>
          </div>
          <div className="mt-1.5 max-w-[640px] text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
            A holding is flagged when broker-flow structure changed against its own
            {run ? ` ${run.window.sessions}-session` : ""} baseline. Flags describe observed trading
            behaviour, not price expectations.
          </div>
          {/* Per-symbol failures are listed in RunReviewBar above, one line
              each, rather than collapsed into "at least one holding". */}
          <AskPanel totals={totals} flaggedSymbols={flaggedRows.map((r) => r.sym)} hasSummary={activeSummary !== null} />

          {/* The point of the button: a portfolio-wide summary, not just a
              count. Concentration/breadth/persistence stay reported
              separately inside it — see lib/llm/portfolioReport.ts. */}
          {portfolioRunHistory.length > 1 && (
            <div className="mt-4 flex items-center gap-2 text-[11px]" style={{ color: "var(--color-muted)" }}>
              <span className="font-mono uppercase" style={{ letterSpacing: "0.08em" }}>
                Past runs
              </span>
              <select
                value={selectedPastRun?.created_at ?? portfolioRunHistory[0].created_at}
                onChange={(e) => setSelectedPortfolioRunAt(e.target.value)}
                className="rounded-md border px-2 py-1 font-mono text-[11px]"
                style={{ borderColor: "var(--color-line)", color: "var(--color-ink)", background: "var(--color-card)" }}
              >
                {portfolioRunHistory.map((r, i) => (
                  <option key={r.created_at} value={r.created_at}>
                    {new Date(r.created_at).toLocaleString()} {"·"} {r.symbols.length} holdings
                    {i === 0 ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeSummary && (
            <PortfolioReportView
              sections={activeSummary.sections}
              creditsUsed={activeSummary.credits_used}
              durationMs={activeSummary.duration_ms}
              holdings={summaryHoldingLines}
            />
          )}
          {!activeSummary && summaryError && (
            <div
              className="mt-4 rounded-lg border p-3.5 font-mono text-[11px]"
              style={{ borderColor: "var(--color-warn-border)", background: "var(--color-warn-bg)", color: "var(--color-warn)" }}
            >
              Portfolio summary unavailable: {summaryError}
            </div>
          )}
        </div>
      )}

      <TotalsStrip totals={totals} />

      <div className="grid gap-6.5 p-7" style={{ gridTemplateColumns: "1fr 344px" }}>
        <OverviewTable rows={rows} />

        <div className="flex flex-col gap-4.5">
          <div className="rounded-lg border bg-[var(--color-card)] p-4.5" style={{ borderColor: "var(--color-line)" }}>
            <div className="flex items-baseline justify-between">
              <div className="font-medium text-[13px] text-[var(--color-ink)]">Portfolio value</div>
              <div className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
                {series.totalSessions > 0 ? `${series.totalSessions} sessions` : "no data"}
              </div>
            </div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
              {series.start && series.end
                ? `Market value of these holdings, ${series.start} to ${series.end}`
                : "Market value across the ingested close window"}
            </div>
            <div className="mt-3.5">
              <PortfolioSparkline series={series} />
            </div>
            <div
              className="mt-3 flex flex-col gap-1.5 border-t pt-2.5 font-mono text-[11px]"
              style={{ borderColor: "var(--color-line-soft)", color: "var(--color-muted)" }}
            >
              <div className="flex justify-between whitespace-nowrap">
                <span>Cost basis</span>
                <span className="text-[var(--color-ink)]">Rp {totals.cost.toLocaleString("id-ID")}</span>
              </div>
              <div className="flex justify-between whitespace-nowrap">
                <span>Market value</span>
                <span className="text-[var(--color-ink)]">
                  {totals.mkt !== null ? `Rp ${totals.mkt.toLocaleString("id-ID")}` : "unavailable"}
                </span>
              </div>
              {series.totalSessions > series.completeSessions && (
                <div className="flex justify-between whitespace-nowrap">
                  <span>Sessions priced</span>
                  <span className="text-[var(--color-ink)]">
                    {series.completeSessions} / {series.totalSessions}
                  </span>
                </div>
              )}
            </div>
          </div>

          <SectorDonut rows={rows} />

          <RunProvenanceCard matched={totals.matchedCount} total={totals.totalCount} />
        </div>
      </div>

      <DisclaimerFooter />
    </>
  );
}
