"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useHoldings } from "@/lib/holdings/store";
import { getAlert, getEvidence, getNarrative, getRun } from "@/lib/data/source";
import { usePosition, useAgentRun, useAgentRunHistory, useComponents, useFlowSeries } from "@/lib/data/ResultsProvider";
import { idr } from "@/lib/format";
import { computeVerdict } from "@/lib/verdict";
import { ProvenanceStrip } from "@/components/ProvenanceStrip";
import { CohortFlowChart } from "@/components/CohortFlowChart";
import { CohortTable } from "@/components/CohortTable";
import { ConcentrationCard, BreadthCard, PersistenceCard, CoverageCard } from "@/components/ComponentCard";
import { NarrativeCard } from "@/components/NarrativeCard";
import { VerdictBadge } from "@/components/VerdictBadge";
import { AnalystChat } from "@/components/AnalystChat";
import { ReportView } from "@/components/ReportView";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function EvidencePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();
  const { holdings } = useHoldings();

  const components = useComponents(symbol);
  const alert = getAlert(symbol);
  if (!components) notFound();

  const run = getRun();

  const evidence = getEvidence(symbol);
  const narrative = getNarrative(symbol);
  const flowSeries = useFlowSeries(symbol);
  const position = usePosition(symbol);
  const holding = holdings.find((h) => h.sym === symbol);

  // The saved Run Analyst report, when one exists, replaces the fixture
  // narrative and verdict guess — it's the real thing the same components fed.
  const agentRun = useAgentRun(symbol);
  const runHistory = useAgentRunHistory(symbol);
  const [selectedRunAt, setSelectedRunAt] = useState<string | null>(null);
  // Defaults to the latest run; picking an older entry from "Past runs" swaps
  // which saved report is displayed, keyed by created_at (rows have no other
  // stable client-facing id).
  const selectedRun = useMemo(
    () => (selectedRunAt ? runHistory.find((r) => r.created_at === selectedRunAt) : undefined) ?? agentRun,
    [selectedRunAt, runHistory, agentRun]
  );
  const verdict = selectedRun?.verdict ?? computeVerdict(alert, components);
  const reportParagraphs = selectedRun?.paragraphs ?? narrative?.paragraphs;

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
            <VerdictBadge verdict={verdict} />
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
          {runHistory.length > 1 && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--color-muted)" }}>
              <span className="font-mono uppercase" style={{ letterSpacing: "0.08em" }}>
                Past runs
              </span>
              <select
                value={selectedRun?.created_at ?? runHistory[0].created_at}
                onChange={(e) => setSelectedRunAt(e.target.value)}
                className="rounded-md border px-2 py-1 font-mono text-[11px]"
                style={{ borderColor: "var(--color-line)", color: "var(--color-ink)", background: "var(--color-card)" }}
              >
                {runHistory.map((r, i) => (
                  <option key={r.created_at} value={r.created_at}>
                    {new Date(r.created_at).toLocaleString()} {"·"} {r.verdict}
                    {i === 0 ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selectedRun?.sections && selectedRun.sections.length > 0 ? (
            <ReportView
              sections={selectedRun.sections}
              steps={selectedRun.steps ?? undefined}
              sources={selectedRun.provenance ?? undefined}
              creditsUsed={selectedRun.credits_used}
              durationMs={selectedRun.duration_ms}
            />
          ) : (
            reportParagraphs && <NarrativeCard paragraphs={reportParagraphs} />
          )}
          {agentRun ? (
            <AnalystChat symbol={symbol} />
          ) : (
            <div className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              Run Analyst from the overview to generate a report and ask questions about it.
            </div>
          )}
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
