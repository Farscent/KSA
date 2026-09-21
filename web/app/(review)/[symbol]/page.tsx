"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useHoldings } from "@/lib/holdings/store";
import { getAlert, getComponents, getEvidence, getNarrative, getPosition, getRun } from "@/lib/data/source";
import { idr } from "@/lib/format";
import { ProvenanceStrip } from "@/components/ProvenanceStrip";
import { CohortFlowChart } from "@/components/CohortFlowChart";
import { CohortTable } from "@/components/CohortTable";
import { ConcentrationCard, BreadthCard, PersistenceCard, CoverageCard } from "@/components/ComponentCard";
import { NarrativeCard } from "@/components/NarrativeCard";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import { getFlowSeries } from "@/lib/data/source";

export default function EvidencePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();
  const { holdings } = useHoldings();

  const alert = getAlert(symbol);
  const components = getComponents(symbol);
  if (!alert || !components) notFound();

  const run = getRun();

  const evidence = getEvidence(symbol);
  const narrative = getNarrative(symbol);
  const flowSeries = getFlowSeries(symbol);
  const position = getPosition(symbol);
  const holding = holdings.find((h) => h.sym === symbol);

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
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium"
              style={{ borderColor: "var(--color-accent)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent)" }} />
              Review
            </span>
          </div>
          <div className="mt-2.5 max-w-[760px] text-xs leading-relaxed" style={{ color: "#4a535e" }}>
            Broker-flow structure over the last {run.window.sessions} sessions differs from this symbol&apos;s own
            prior baseline. This report shows what was observed. It does
            not state a cause and does not suggest an action.
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

      <ProvenanceStrip coverage={components.coverage} />

      <div className="grid gap-6.5 p-7" style={{ gridTemplateColumns: "1fr 372px" }}>
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
            <div className="font-medium text-[13.5px] text-[var(--color-ink)]">
              Broker flow by cohort {"—"} {run.window.sessions} sessions
            </div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
              Cumulative net value (buy {"−"} sell), IDR. Unknown cohort is not plotted {"—"} values unavailable.
            </div>
            <CohortFlowChart series={flowSeries} />
            <CohortTable evidence={evidence} />
          </div>

          <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Severity components</div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                  Reported separately. There is no combined severity score.
                </div>
              </div>
              <span
                className="rounded border border-dashed px-2 py-0.5 font-mono text-[10px] font-medium uppercase"
                style={{ borderColor: "var(--color-warn-border)", background: "var(--color-warn-bg)", color: "var(--color-warn)", letterSpacing: "0.06em" }}
              >
                Example values {"—"} scoring not finalised
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3.5">
              <ConcentrationCard block={components.concentration} />
              <BreadthCard block={components.breadth} />
              <PersistenceCard block={components.persistence} />
              <CoverageCard block={components.coverage} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4.5">
          {narrative && <NarrativeCard paragraphs={narrative.paragraphs} />}
          <div className="rounded-lg border p-4.5" style={{ background: "var(--color-surface)", borderColor: "var(--color-line)" }}>
            <div className="font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.09em" }}>
              Review this holding against peers
            </div>
            <div className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "#4a535e" }}>
              Compare {symbol} with sector peers that meet the liquidity and data-coverage rules.
            </div>
            <div className="mt-3.5">
              <Link
                href={`/${symbol}/peers`}
                className="inline-block cursor-pointer rounded-md px-3.5 py-2.5 font-medium text-xs text-white"
                style={{ background: "var(--color-accent)" }}
              >
                Open comparison
              </Link>
            </div>
          </div>
        </div>
      </div>

      <DisclaimerFooter right="Sectors Review does not place orders, hold funds, or forecast prices." />
    </>
  );
}
