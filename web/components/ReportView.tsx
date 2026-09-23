"use client";

import { useState } from "react";

import type { ReportSection } from "@/lib/llm/report";
import type { StepTrace } from "@/lib/agent/package";
import { ReportSections } from "@/components/ReportSections";

interface Source {
  endpoint: string;
  fetched_at: string;
  cached: boolean;
  credits: number;
}

interface ReportViewProps {
  sections: ReportSection[];
  steps?: StepTrace[];
  sources?: Source[];
  creditsUsed?: number | null;
  durationMs?: number | null;
}

/**
 * The saved report: headline visible, full sectioned analysis behind "Show
 * full analysis".
 *
 * Each section footer lists the `grounded_in` paths it was written from, so a
 * reader can audit that every figure traces to a computed value rather than
 * taking the prose on trust. A section with no paragraphs renders as an
 * explicit "not measurable" with its reason codes — never silently dropped.
 */
export function ReportView({ sections, steps, sources, creditsUsed, durationMs }: ReportViewProps) {
  const [expanded, setExpanded] = useState(false);

  // The collapsed view leads with "what changed underneath" — the broker-flow
  // section is the product, so it headlines even though the expanded report
  // opens with the position for context. Falls back to whatever did get
  // written if flow was not measurable this run.
  const written = sections.filter((s) => s.paragraphs.length > 0);
  const lead = written.find((s) => s.id === "flow_structure") ?? written[0];
  if (!lead) return null;

  return (
    <div
      className="rounded-lg border bg-[var(--color-card)] p-6"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-medium text-[13px] text-[var(--color-ink)]">Analyst report</div>
        <div className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          {typeof creditsUsed === "number" ? `${creditsUsed} credits` : null}
          {typeof creditsUsed === "number" && typeof durationMs === "number" ? " · " : null}
          {typeof durationMs === "number" ? `${(durationMs / 1000).toFixed(1)}s` : null}
        </div>
      </div>

      <p className="mt-3 text-[13.5px] leading-7" style={{ color: "var(--color-ink)" }}>
        {lead.paragraphs[0]}
      </p>

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
