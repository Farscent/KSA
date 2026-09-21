"use client";

import { useResults } from "@/lib/data/ResultsProvider";

/**
 * Provenance for the portfolio screen, sourced from the real batch run in
 * Supabase. Before the first run has landed there is nothing to describe, and
 * saying so is the honest rendering — a blank or invented date would read as
 * data that exists.
 */
export function RunProvenanceCard({ matched, total }: { matched: number; total: number }) {
  const { run } = useResults();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between">
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className="rounded-lg border p-4.5" style={{ background: "var(--color-surface)", borderColor: "var(--color-line)" }}>
      <div
        className="font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
        style={{ letterSpacing: "0.09em" }}
      >
        Run provenance
      </div>
      <div className="mt-2.5 flex flex-col gap-2 font-mono text-[11.5px]" style={{ color: "#3d4650" }}>
        {run ? (
          <>
            {row("Data date", run.data_date)}
            {row("Trade date", run.trade_date)}
            {row("Window", `${run.window.sessions} sessions · ${run.window.start} → ${run.window.end}`)}
            {row("Symbols matched", `${matched} / ${total}`)}
            {row("Cohorts unavailable", `${run.cohorts_unavailable} (unknown)`)}
          </>
        ) : (
          <div style={{ color: "var(--color-warn)" }}>
            No batch run has been ingested yet — prices and coverage are unavailable, not zero.
          </div>
        )}
      </div>
    </div>
  );
}
