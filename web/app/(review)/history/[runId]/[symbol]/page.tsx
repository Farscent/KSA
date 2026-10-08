import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchAgentRunForRun } from "@/lib/data/agentRuns";
import { fetchPortfolioRunById } from "@/lib/data/portfolioRuns";
import { ConcentrationCard, BreadthCard, PersistenceCard, CoverageCard } from "@/components/ComponentCard";
import { CohortFlowChart } from "@/components/CohortFlowChart";
import { EvidenceCoverageCard } from "@/components/EvidenceCoverageCard";
import { NarrativeCard } from "@/components/NarrativeCard";
import { PastRunBanner } from "@/components/PastRunBanner";
import { ReportSections } from "@/components/ReportSections";
import { StatusChip } from "@/components/StatusChip";
import { VerdictBadge } from "@/components/VerdictBadge";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import { holdingStatus } from "@/lib/flowStatus";
import { savedVerdict } from "@/lib/verdict";
import type { ServeFlowSeriesRecord } from "@/lib/contract/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const card = "rounded-lg border bg-[var(--color-card)] p-5";

export default async function PastSymbolRunPage({ params }: { params: Promise<{ runId: string; symbol: string }> }) {
  const { runId, symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  if (!UUID.test(runId)) notFound();

  const [run, report] = await Promise.all([fetchPortfolioRunById(runId), fetchAgentRunForRun(runId, symbol)]);
  if (!run || !report) notFound();

  // Everything below comes from this run's saved package, not from today's
  // scored components, so the page cannot drift from what the run saw.
  const components = report.flow_components;
  const series: ServeFlowSeriesRecord[] = (report.flow_series as ServeFlowSeriesRecord[] | null) ?? [];
  const status = holdingStatus({ run: report, currentTradeDate: null, currentLots: null });

  return (
    <>
      <PastRunBanner
        createdAt={report.created_at}
        asOf={report.trade_date}
        backHref={`/history/${runId}`}
        backLabel="Back to this run"
      />

      <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-5.5" style={{ borderColor: "var(--color-line)" }}>
        <Link href={`/history/${runId}`} className="mb-3.5 inline-flex font-medium text-xs" style={{ color: "var(--color-accent)" }}>
          {"←"} Back to the run of {new Date(run.created_at).toLocaleString()}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-medium text-[var(--color-ink)]">{symbol}</span>
          <StatusChip status={status} />
          <VerdictBadge verdict={savedVerdict(report)} />
        </div>
      </div>

      <div className="mx-auto flex max-w-[1000px] flex-col gap-5 p-7">
        {report.sections && report.sections.length > 0 ? (
          <div className={card} style={{ borderColor: "var(--color-line)" }}>
            <ReportSections
              sections={report.sections}
              steps={report.steps ?? undefined}
              sources={report.provenance ?? undefined}
            />
          </div>
        ) : (
          <NarrativeCard paragraphs={report.paragraphs} />
        )}

        {report.coverage && <EvidenceCoverageCard coverage={report.coverage} />}

        {components && (
          <div className={card} style={{ borderColor: "var(--color-line)" }}>
            <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Severity components at the time of this run</div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
              Reported separately. There is no combined severity score.
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3.5">
              <ConcentrationCard block={components.concentration} />
              <BreadthCard block={components.breadth} />
              <PersistenceCard block={components.persistence} />
              <CoverageCard block={components.coverage} />
            </div>
          </div>
        )}

        {series.length > 0 && (
          <div className={card} style={{ borderColor: "var(--color-line)" }}>
            <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Broker flow by cohort</div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
              Cumulative net value (buy {"−"} sell), IDR, as saved with this run.
            </div>
            <CohortFlowChart series={series} />
          </div>
        )}
      </div>

      <DisclaimerFooter />
    </>
  );
}
