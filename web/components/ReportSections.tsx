"use client";

import type { StepTrace } from "@/lib/agent/package";

interface Source {
  endpoint: string;
  fetched_at: string;
  cached: boolean;
  credits: number;
}

/** Shared shape between `lib/llm/report.ts` and `lib/llm/portfolioReport.ts` —
 * both mirror each other on purpose, so one type covers both callers. */
export interface ReportSectionLike {
  id: string;
  title: string;
  paragraphs: string[];
  grounded_in: string[];
  value_status: "AVAILABLE" | "UNAVAILABLE";
  reason_codes: string[];
}

interface ReportSectionsProps {
  sections: ReportSectionLike[];
  steps?: StepTrace[];
  sources?: Source[];
}

const STATUS_COLOR: Record<string, string> = {
  done: "var(--color-muted)",
  failed: "var(--color-accent)",
  skipped: "var(--color-muted)",
};

const STATUS_MARK: Record<string, string> = { done: "✓", failed: "✕", skipped: "–" };

/**
 * The expanded body shared by ReportView and PortfolioReportView: the section
 * prose, each one's `grounded_in` audit trail, and the research
 * log/sources — identical between a per-symbol report and the portfolio
 * summary, so it lives once here rather than drifting between two copies.
 *
 * Every path and figure that was visible before is still here — grounded_in
 * and the research log are just tucked behind their own disclosures instead
 * of forced into the main reading flow.
 */
export function ReportSections({ sections, steps, sources }: ReportSectionsProps) {
  return (
    <div className="flex flex-col">
      {sections.map((section, i) => (
        <section key={section.id} className={i > 0 ? "mt-6 border-t pt-5" : ""} style={i > 0 ? { borderColor: "var(--color-line-soft)" } : undefined}>
          <div className="font-semibold text-[13.5px] text-[var(--color-ink)]">{section.title}</div>

          {section.paragraphs.length > 0 ? (
            <>
              {section.paragraphs.map((paragraph, j) => (
                <p key={j} className="mt-2.5 text-[13.5px] leading-7" style={{ color: "var(--color-ink)" }}>
                  {paragraph}
                </p>
              ))}
              {section.grounded_in.length > 0 && (
                <details className="mt-2.5">
                  <summary
                    className="cursor-pointer font-mono text-[10.5px] uppercase"
                    style={{ letterSpacing: "0.07em", color: "var(--color-muted)" }}
                  >
                    Sources cited ({section.grounded_in.length})
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {section.grounded_in.map((path) => (
                      <span
                        key={path}
                        className="rounded-full border px-2 py-0.5 font-mono text-[10px]"
                        style={{ borderColor: "var(--color-line)", color: "var(--color-muted)" }}
                      >
                        {path}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div
              className="mt-2.5 rounded-md border border-dashed px-3 py-2 text-[12.5px] leading-relaxed"
              style={{ borderColor: "var(--color-line)", color: "var(--color-muted)" }}
            >
              Not measurable this run
              {section.reason_codes.length > 0 ? ` — ${section.reason_codes.join(", ")}` : ""}.
            </div>
          )}
        </section>
      ))}

      {((steps && steps.length > 0) || (sources && sources.length > 0)) && (
        <details className="mt-6 border-t pt-5" style={{ borderColor: "var(--color-line-soft)" }}>
          <summary
            className="cursor-pointer font-mono text-[11px] uppercase"
            style={{ letterSpacing: "0.09em", color: "var(--color-muted)" }}
          >
            Run details
          </summary>

          {steps && steps.length > 0 && (
            <div className="mt-3">
              <div
                className="font-mono text-[10.5px] uppercase"
                style={{ letterSpacing: "0.07em", color: "var(--color-muted)" }}
              >
                Research log
              </div>
              <div className="mt-1.5 flex flex-col gap-1 font-mono text-[10.5px]">
                {steps.map((step, i) => (
                  <div key={`${step.id}-${i}`} className="flex items-baseline justify-between gap-3">
                    <span style={{ color: STATUS_COLOR[step.status] ?? "var(--color-muted)" }}>
                      {STATUS_MARK[step.status] ?? "·"} {step.label}
                      {step.detail ? ` — ${step.detail}` : ""}
                    </span>
                    <span className="whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                      {step.credits > 0 ? `${step.credits}c · ` : ""}
                      {step.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sources && sources.length > 0 && (
            <div className="mt-3">
              <div
                className="font-mono text-[10.5px] uppercase"
                style={{ letterSpacing: "0.07em", color: "var(--color-muted)" }}
              >
                Sources
              </div>
              <div className="mt-1.5 flex flex-col gap-1 font-mono text-[10.5px]" style={{ color: "var(--color-muted)" }}>
                {sources.map((source, i) => (
                  <div key={`${source.endpoint}-${i}`}>
                    {source.endpoint} · {source.fetched_at.slice(0, 10)}
                    {source.cached ? " · cached" : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
