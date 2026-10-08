"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { flowWindow } from "@/lib/data/window";
import { useAgentRun, useComponents, useFlowSeries } from "@/lib/data/ResultsProvider";
import { savedVerdict } from "@/lib/verdict";
import { CohortFlowChart } from "@/components/CohortFlowChart";
import { ConcentrationCard, BreadthCard, PersistenceCard, CoverageCard } from "@/components/ComponentCard";
import { EvidenceCoverageCard } from "@/components/EvidenceCoverageCard";
import { NarrativeCard } from "@/components/NarrativeCard";
import { ReportSections } from "@/components/ReportSections";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SymbolTabs } from "@/components/SymbolTabs";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

const card = "rounded-lg border bg-[var(--color-card)] p-5";

export default function DetailsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();

  const components = useComponents(symbol);
  if (!components) notFound();

  const flowSeries = useFlowSeries(symbol);
  const window = flowWindow(flowSeries);

  // The latest saved run. Older runs are read-only snapshots under /history.
  const selectedRun = useAgentRun(symbol);
  const paragraphs = selectedRun?.paragraphs;
  const measured = components.concentration.basis === "MEASURED";

  return (
    <>
      <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-5.5" style={{ borderColor: "var(--color-line)" }}>
        <Link
          href={`/${symbol}`}
          className="mb-3.5 inline-flex items-center gap-1.5 font-medium text-xs"
          style={{ color: "var(--color-accent)" }}
        >
          {"←"} Back to {symbol} summary
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-medium text-[var(--color-ink)]">{symbol}</span>
          <span className="text-sm" style={{ color: "#4a535e" }}>
            Full analysis
          </span>
          {selectedRun && <VerdictBadge verdict={savedVerdict(selectedRun)} />}
          <Link href="/history" className="ml-auto font-medium text-[11.5px] underline" style={{ color: "var(--color-accent)" }}>
            Past runs
          </Link>
        </div>
      </div>

      <SymbolTabs symbol={symbol} hasPeers={Boolean(selectedRun?.peers)} />

      <div className="mx-auto flex max-w-[1000px] flex-col gap-5 p-7">
        {selectedRun?.sections && selectedRun.sections.length > 0 ? (
          <div className={card} style={{ borderColor: "var(--color-line)" }}>
            <ReportSections
              sections={selectedRun.sections}
              steps={selectedRun.steps ?? undefined}
              sources={selectedRun.provenance ?? undefined}
            />
          </div>
        ) : (
          paragraphs && <NarrativeCard paragraphs={paragraphs} />
        )}

        {selectedRun?.coverage && <EvidenceCoverageCard coverage={selectedRun.coverage} />}

        <div className={card} style={{ borderColor: "var(--color-line)" }}>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Severity components</div>
              <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                Reported separately. There is no combined severity score.
              </div>
            </div>
            {!measured && (
              <span
                className="rounded border border-dashed px-2 py-0.5 font-mono text-[10px] font-medium uppercase"
                style={{ borderColor: "var(--color-warn-border)", background: "var(--color-warn-bg)", color: "var(--color-warn)", letterSpacing: "0.06em" }}
              >
                Example values {"—"} scoring not finalised
              </span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3.5">
            <ConcentrationCard block={components.concentration} />
            <BreadthCard block={components.breadth} />
            <PersistenceCard block={components.persistence} />
            <CoverageCard block={components.coverage} />
          </div>
        </div>

        <div className={card} style={{ borderColor: "var(--color-line)" }}>
          <div className="font-medium text-[13.5px] text-[var(--color-ink)]">
            Broker flow by cohort{window ? <> {"—"} {window.sessions} sessions</> : null}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
            Cumulative net value (buy {"−"} sell), IDR. Unknown cohort is not plotted {"—"} values unavailable.
          </div>
          <CohortFlowChart series={flowSeries} />
        </div>
      </div>

      <DisclaimerFooter right="Sectors Review does not place orders, hold funds, or forecast prices." />
    </>
  );
}
