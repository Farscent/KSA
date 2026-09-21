"use client";

import { useMemo, useState } from "react";
import { useHoldings } from "@/lib/holdings/store";
import { buildRows, computeTotals, computeValueSeries } from "@/lib/portfolio";
import { RunReviewBar } from "@/components/RunReviewBar";
import { TotalsStrip } from "@/components/TotalsStrip";
import { OverviewTable } from "@/components/OverviewTable";
import { PortfolioSparkline } from "@/components/PortfolioSparkline";
import { SectorDonut } from "@/components/SectorDonut";
import { RunProvenanceCard } from "@/components/RunProvenanceCard";
import { AskPanel } from "@/components/AskPanel";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import Link from "next/link";
import { useResults } from "@/lib/data/ResultsProvider";

type RunState = "notRun" | "running" | "reviewRun";

export default function DashboardPage() {
  const { holdings } = useHoldings();
  const [runState, setRunState] = useState<RunState>("notRun");
  const { positions, priceHistory, run } = useResults();

  const rows = useMemo(() => buildRows(holdings, positions), [holdings, positions]);
  const totals = useMemo(() => computeTotals(rows), [rows]);
  const series = useMemo(() => computeValueSeries(holdings, priceHistory), [holdings, priceHistory]);
  const flaggedRows = rows.filter((r) => r.flagged);

  function onRun() {
    setRunState("running");
    setTimeout(() => setRunState("reviewRun"), 1400);
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
      {runState !== "reviewRun" && <RunReviewBar state={runState} onRun={onRun} holdingsCount={holdings.length} />}

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
          <AskPanel totals={totals} flaggedSymbols={flaggedRows.map((r) => r.sym)} />
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
