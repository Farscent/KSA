import type { Totals } from "@/lib/portfolio";
import { Value } from "@/components/Value";

export function TotalsStrip({ totals }: { totals: Totals }) {
  const coveragePct = totals.totalCount > 0 ? totals.matchedCount / totals.totalCount : null;

  const cell = (label: string, node: React.ReactNode) => (
    <div className="whitespace-nowrap text-right">
      <div
        className="font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
        style={{ letterSpacing: "0.09em" }}
      >
        {label}
      </div>
      <div className="mt-1 font-mono text-[15px] font-medium tabular-nums text-[var(--color-ink)]">{node}</div>
    </div>
  );

  return (
    <div
      className="flex justify-between gap-5 border-b bg-[var(--color-card)] px-7 py-4"
      style={{ borderColor: "var(--color-line)" }}
    >
      {cell("Cost basis", <Value value={totals.cost} format="idr" />)}
      {cell("Market value", <Value value={totals.mkt} format="idr" />)}
      {cell(
        "Unrealized P&L",
        <>
          <Value value={totals.pl} format="signedIdr" />
          {totals.plPct !== null && (
            <span className="ml-1 font-mono text-[10.5px] font-normal" style={{ color: "var(--color-muted)" }}>
              {"·"} <Value value={totals.plPct} format="signedPct" />
            </span>
          )}
        </>
      )}
      {cell("Coverage", <Value value={coveragePct} format="pct" />)}
    </div>
  );
}
