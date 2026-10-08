"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useHoldings } from "@/lib/holdings/store";
import { flowWindow } from "@/lib/data/window";
import { usePosition, useAgentRun, useComponents, useFlowSeries, useResults } from "@/lib/data/ResultsProvider";
import { idr, signedIdr, signedPct } from "@/lib/format";
import { priceOverview } from "@/lib/price/overview";
import { PriceChart } from "@/components/PriceChart";
import { KeyStats } from "@/components/KeyStats";
import { savedVerdict } from "@/lib/verdict";
import { ProvenanceStrip } from "@/components/ProvenanceStrip";
import { CohortFlowChart } from "@/components/CohortFlowChart";
import { ConcentrationCard, BreadthCard, PersistenceCard, CoverageCard } from "@/components/ComponentCard";
import { NarrativeCard } from "@/components/NarrativeCard";
import { VerdictBadge } from "@/components/VerdictBadge";
import { StatusChip } from "@/components/StatusChip";
import { SymbolTabs } from "@/components/SymbolTabs";
import { RunSymbolButton } from "@/components/RunSymbolButton";
import { holdingStatus } from "@/lib/flowStatus";
import { AnalystChat } from "@/components/AnalystChat";
import { SummaryCard } from "@/components/SummaryCard";
import { summarise } from "@/lib/agent/summary";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function EvidencePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();
  const { holdings } = useHoldings();

  const components = useComponents(symbol);
  if (!components) notFound();

  const flowSeries = useFlowSeries(symbol);
  const window = flowWindow(flowSeries);
  const position = usePosition(symbol);
  const holding = holdings.find((h) => h.sym === symbol);

  // The latest saved Run Analyst report. Older ones are read-only under /history.
  const selectedRun = useAgentRun(symbol);
  const reportParagraphs = selectedRun?.paragraphs;
  const summary = selectedRun?.sections ? summarise(selectedRun.sections) : null;
  const agentRun = selectedRun;
  const status = holdingStatus({ run: selectedRun, currentTradeDate: components.trade_date, currentLots: holding?.lots ?? null });
  const points = useResults().historyOf(symbol)?.points ?? [];
  const overview = priceOverview(points);
  const up = (overview?.dayChange?.abs ?? 0) >= 0;

  return (
    <>
      <div
        className="flex flex-wrap items-start justify-between gap-7.5 border-b bg-[var(--color-card)] px-7 pb-5 pt-6"
        style={{ borderColor: "var(--color-line)" }}
      >
        <div>
          <Link
            href="/"
            className="mb-3.5 inline-flex items-center gap-1.5 font-medium text-xs"
            style={{ color: "var(--color-accent)" }}
          >
            {"←"} Back to overview
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-medium text-[var(--color-ink)]">{symbol}</span>
            <span className="text-sm" style={{ color: "#4a535e" }}>
              {position?.name ?? symbol}
            </span>
            <StatusChip status={status} />
            {selectedRun && <VerdictBadge verdict={savedVerdict(selectedRun)} />}
          </div>
          {overview && (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[32px] font-medium tabular-nums text-[var(--color-ink)]">{idr(overview.last.close)}</span>
              {overview.dayChange && (
                <span className="font-mono text-sm font-medium tabular-nums" style={{ color: up ? "#2d6a4f" : "#9b2c2c" }}>
                  {signedIdr(overview.dayChange.abs)} ({signedPct(overview.dayChange.fraction, 2)})
                </span>
              )}
              <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                Close of {overview.last.trade_date} {"·"} end-of-day, not live
              </span>
            </div>
          )}
          <div className="mt-2.5 max-w-[760px] text-xs leading-relaxed" style={{ color: "#4a535e" }}>
            Broker-flow structure over the last {window?.sessions ?? "scored"} sessions, set against this symbol&apos;s own
            baseline. This report shows what was observed. It does not state a cause and does not suggest an action.
          </div>
        </div>
        {holding && (
          <div className="flex flex-none gap-6 text-right">
            <div>
              <div className="font-mono text-[10px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.09em" }}>
                Your position
              </div>
              <div className="mt-1 font-mono text-[15px] font-medium tabular-nums text-[var(--color-ink)]">
                {holding.lots} lots
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.09em" }}>
                Avg price
              </div>
              <div className="mt-1 font-mono text-[15px] font-medium tabular-nums text-[var(--color-ink)]">
                {idr(holding.avg)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.09em" }}>
                Cost basis
              </div>
              <div className="mt-1 font-mono text-[15px] font-medium tabular-nums text-[var(--color-ink)]">
                {idr(holding.lots * 100 * holding.avg)}
              </div>
            </div>
          </div>
        )}
      </div>

      <SymbolTabs symbol={symbol} hasPeers={Boolean(selectedRun?.peers)} />

      <ProvenanceStrip coverage={components.coverage} tradeDate={components.trade_date} window={window} />

      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-7">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
            <PriceChart points={points} avgPrice={holding?.avg} />
            {overview && (
              <>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] tabular-nums">
                  {overview.performance.map((p) => (
                    <div key={p.label}>
                      <span style={{ color: "var(--color-muted)" }}>{p.label} </span>
                      <span className="text-[var(--color-ink)]">{p.change === null ? "not enough data" : signedPct(p.change, 2)}</span>
                    </div>
                  ))}
                  <div>
                    <span style={{ color: "var(--color-muted)" }}>Range </span>
                    <span className="text-[var(--color-ink)]">{idr(overview.windowLow)} {"–"} {idr(overview.windowHigh)}</span>
                  </div>
                </div>
                <div className="mt-2 text-[11px]" style={{ color: "var(--color-muted)" }}>
                  Daily close and volume from Sectors, {overview.from} to {overview.to} ({overview.sessions} sessions). Close only, so no candlesticks.
                </div>
              </>
            )}
          </div>
          <KeyStats sections={selectedRun?.sections ?? null} identity={selectedRun?.identity?.data ?? null} />
        </div>

        {summary ? (
          <SummaryCard summary={summary} coverage={selectedRun?.coverage ?? null} symbol={symbol} />
        ) : selectedRun?.sections && selectedRun.sections.length > 0 ? (
          // Saved before the table format: no rows to summarise, so lead with
          // the one paragraph it always showed and send the rest to details.
          <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
            <p className="text-[14px] leading-7 text-[var(--color-ink)]">{reportParagraphs?.[0]}</p>
            <Link
              href={`/${symbol}/details`}
              className="mt-4 inline-block rounded-md px-3.5 py-2.5 font-medium text-xs text-white hover:brightness-110"
              style={{ background: "var(--color-accent)" }}
            >
              View full analysis
            </Link>
          </div>
        ) : (
          <>
            {reportParagraphs && <NarrativeCard paragraphs={reportParagraphs} />}
            <div className="grid grid-cols-2 gap-3.5">
              <ConcentrationCard block={components.concentration} />
              <BreadthCard block={components.breadth} />
              <PersistenceCard block={components.persistence} />
              <CoverageCard block={components.coverage} />
            </div>
          </>
        )}

        <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
          <div className="font-medium text-[13.5px] text-[var(--color-ink)]">
            Broker flow by cohort{window ? <> {"—"} {window.sessions} sessions</> : null}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
            Cumulative net value (buy {"−"} sell), IDR. Unknown cohort is not plotted {"—"} values unavailable.
          </div>
          <CohortFlowChart series={flowSeries} />
        </div>

        <RunSymbolButton symbol={symbol} hasRun={Boolean(agentRun)} />

        {agentRun && <AnalystChat symbol={symbol} />}
      </div>

      <DisclaimerFooter right="Sectors Review does not place orders, hold funds, or forecast prices." />
    </>
  );
}
