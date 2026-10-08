import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchAgentRunsForRun } from "@/lib/data/agentRuns";
import { fetchPortfolioRunById } from "@/lib/data/portfolioRuns";
import { PortfolioReportView } from "@/components/PortfolioReportView";
import { PastRunBanner } from "@/components/PastRunBanner";
import { StatusChip } from "@/components/StatusChip";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import { holdingStatus } from "@/lib/flowStatus";
import { savedVerdict } from "@/lib/verdict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PastRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();

  const run = await fetchPortfolioRunById(runId);
  if (!run) notFound();
  const reports = await fetchAgentRunsForRun(runId);

  const lines = reports.map((r) => ({
    symbol: r.symbol,
    verdict: savedVerdict(r),
    detail: r.sections?.find((s) => s.id === "flow_structure")?.paragraphs[0] ?? "no flow section",
  }));

  return (
    <>
      <PastRunBanner createdAt={run.created_at} asOf={run.as_of} />

      <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-6" style={{ borderColor: "var(--color-line)" }}>
        <div className="font-mono text-[11px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.1em" }}>
          Run of {new Date(run.created_at).toLocaleString()}
        </div>
        <div className="mt-1.5 font-serif text-[22px] text-[var(--color-ink)]">
          {run.symbols.length} holdings reviewed {"·"} data {run.as_of}
        </div>

        {reports.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-2">
            {reports.map((r) => (
              <Link
                key={r.symbol}
                href={`/history/${runId}/${r.symbol}`}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                style={{ borderColor: "var(--color-line)" }}
              >
                <span className="font-mono text-[12px] font-medium text-[var(--color-ink)]">{r.symbol}</span>
                <StatusChip status={holdingStatus({ run: r, currentTradeDate: null, currentLots: null })} />
              </Link>
            ))}
          </div>
        )}

        <PortfolioReportView
          sections={run.sections}
          steps={run.steps ?? undefined}
          sources={run.provenance ?? undefined}
          creditsUsed={run.credits_used}
          durationMs={run.duration_ms}
          holdings={lines}
          hrefBase={`/history/${runId}`}
        />
        {reports.length === 0 && (
          <div className="mt-3 text-[11.5px]" style={{ color: "var(--color-muted)" }}>
            The per-holding reports for this run were saved before runs were linked, so only the portfolio summary is
            available.
          </div>
        )}
      </div>

      <DisclaimerFooter />
    </>
  );
}
