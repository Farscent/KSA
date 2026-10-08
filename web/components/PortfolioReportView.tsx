"use client";

import { useState } from "react";
import Link from "next/link";

import type { ReportSection } from "@/lib/llm/portfolioReport";
import type { StepTrace } from "@/lib/agent/package";
import { ReportSections } from "@/components/ReportSections";

interface Source {
  endpoint: string;
  fetched_at: string;
  cached: boolean;
  credits: number;
}

interface HoldingLine {
  symbol: string;
  verdict: string;
  detail: string;
}

interface PortfolioReportViewProps {
  sections: ReportSection[];
  steps?: StepTrace[];
  sources?: Source[];
  creditsUsed?: number | null;
  durationMs?: number | null;
  holdings?: HoldingLine[];
  /** Path prefix a holding line links under (`${hrefBase}/${symbol}`); defaults to the current stock pages. A string, not a function, because History's server page passes it to this client component. */
  hrefBase?: string;
}

const VERDICT_COLOR: Record<string, string> = {
  Healthy: "var(--color-muted)",
  Watch: "var(--color-warn)",
  Rebalance: "var(--color-accent)",
};

/**
 * The portfolio-wide summary: this is the dashboard's centrepiece after a
 * Run Analyst pass, not a per-holding detail page. Headline paragraph always
 * visible, "Show full analysis" expands the rest. Each section footer lists
 * the `grounded_in` paths it was written from, so a reader can audit that
 * every figure traces to a computed value — same discipline as
 * ReportView.tsx, one level up.
 */
export function PortfolioReportView({
  sections,
  steps,
  sources,
  creditsUsed,
  durationMs,
  holdings,
  hrefBase = "",
}: PortfolioReportViewProps) {
  const [expanded, setExpanded] = useState(false);

  const written = sections.filter((s) => s.paragraphs.length > 0 || (s.rows?.length ?? 0) > 0);
  if (written.length === 0) return null;
  const keyPoints = sections.filter((s) => s.headline);
  const lead = written.find((s) => s.id === "overview") ?? written[0];

  return (
    <div
      className="rounded-lg border bg-[var(--color-card)] p-6 mt-4"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Portfolio analyst summary</div>
        <div className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          {typeof creditsUsed === "number" ? `${creditsUsed} credits` : null}
          {typeof creditsUsed === "number" && typeof durationMs === "number" ? " · " : null}
          {typeof durationMs === "number" ? `${(durationMs / 1000).toFixed(1)}s` : null}
        </div>
      </div>

      {keyPoints.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="font-mono text-[10.5px] uppercase" style={{ letterSpacing: "0.07em", color: "var(--color-muted)" }}>
            Key points
          </div>
          {keyPoints.map((s) => (
            <div key={s.id} className="text-[13px] leading-6" style={{ color: "var(--color-ink)" }}>
              <span className="font-medium">{s.title}.</span> {s.headline}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13.5px] leading-7" style={{ color: "var(--color-ink)" }}>
          {lead.paragraphs[0]}
        </p>
      )}

      {holdings && holdings.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "var(--color-line-soft)" }}>
          {holdings.map((h) => (
            <Link
              key={h.symbol}
              href={`${hrefBase}/${h.symbol}`}
              className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-[11.5px] hover:bg-[var(--color-surface)]"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono font-medium text-[var(--color-ink)]">{h.symbol}</span>
                <span style={{ color: VERDICT_COLOR[h.verdict] ?? "var(--color-muted)" }}>{h.verdict}</span>
              </span>
              <span className="truncate" style={{ color: "var(--color-muted)", maxWidth: 340 }}>
                {h.detail}
              </span>
            </Link>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-4 cursor-pointer rounded-md border px-3 py-1.5 font-medium text-[11.5px]"
        style={{ borderColor: "var(--color-line)", color: "var(--color-ink)" }}
      >
        {expanded ? "Hide full analysis" : `Show full analysis (${sections.length} sections)`}
      </button>

      {expanded && (
        <div className="mt-5">
          <ReportSections sections={sections} steps={steps} sources={sources} />
        </div>
      )}
    </div>
  );
}
