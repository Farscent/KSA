import { getRun } from "@/lib/data/source";
import type { CoverageBlock } from "@/lib/contract/types";
import { Value } from "@/components/Value";

export function ProvenanceStrip({ coverage }: { coverage: CoverageBlock }) {
  const run = getRun();

  const cell = (label: string, node: React.ReactNode, color?: string) => (
    <>
      <div className="flex flex-col gap-0.5 px-6.5 py-2.5">
        <span
          className="font-mono text-[9.5px] uppercase"
          style={{ color: "#8a939e", letterSpacing: "0.09em" }}
        >
          {label}
        </span>
        <span className="font-mono text-xs font-medium" style={{ color: color ?? "var(--color-ink)" }}>
          {node}
        </span>
      </div>
      <div className="w-px h-7 self-center" style={{ background: "var(--color-line)" }} />
    </>
  );

  return (
    <div
      className="flex flex-wrap items-center border-b"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-line)" }}
    >
      {cell("Data date", run.data_date)}
      {cell("Trade date", run.trade_date)}
      {cell("Window", `${run.window.sessions} sessions · ${run.window.start} → ${run.window.end}`)}
      {cell(
        "Coverage",
        <>
          <Value value={coverage.matched_share} format="pct" /> of matched value {"·"}{" "}
          <Value value={coverage.cohorts_available} /> of <Value value={coverage.cohorts_total} /> cohorts
        </>
      )}
      <div className="flex flex-col gap-0.5 py-2.5 pl-6.5">
        <span className="font-mono text-[9.5px] uppercase" style={{ color: "#8a939e", letterSpacing: "0.09em" }}>
          Completeness
        </span>
        <span className="font-mono text-xs font-medium" style={{ color: "var(--color-warn)" }}>
          {coverage.completeness === "PARTIAL" ? "Partial — unknown cohort unavailable" : coverage.completeness}
        </span>
      </div>
    </div>
  );
}
