import type { ScorecardRow, ScorecardCell } from "@/lib/contract/types";
import { Value } from "@/components/Value";

function formatCell(cell: ScorecardCell, unit: ScorecardRow["unit"]) {
  if (cell.value_status === "UNAVAILABLE") return <Value value={null} />;
  if (typeof cell.value === "string") return cell.value;
  if (unit === "IDR") {
    const millions = (cell.value as number) / 1_000_000;
    const sign = millions >= 0 ? "+" : "−";
    return `${sign}${Math.abs(millions).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  }
  if (unit === "SHARE" || unit === "PERCENT") return <Value value={cell.value} format="pct" />;
  return String(cell.value);
}

export function ScorecardGrid({
  symbol,
  shortlist,
  scorecard,
}: {
  symbol: string;
  shortlist: string[];
  scorecard: ScorecardRow[];
}) {
  const columns = [symbol, ...shortlist];

  return (
    <div className="overflow-hidden rounded-lg border bg-[var(--color-card)]" style={{ borderColor: "var(--color-line)" }}>
      <div
        className="flex flex-wrap items-baseline justify-between gap-1.5 border-b px-4.5 py-3.5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-line-strong)" }}
      >
        <span className="font-medium text-[13px] text-[var(--color-ink)]">
          Shortlist scorecard{" "}
          <span className="font-mono text-[11.5px] font-normal text-[var(--color-muted)]">
            {"·"} {shortlist.length} eligible peers
          </span>
        </span>
        <span className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          Held symbol shown first for reference
        </span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 560 }}>
          <div className="grid" style={{ gridTemplateColumns: `236px repeat(${columns.length}, 1fr)` }}>
            <div
              className="px-4.5 py-3.5 font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
              style={{ background: "#faf9f7", borderBottom: "1px solid var(--color-line-strong)", letterSpacing: "0.09em" }}
            >
              Metric
            </div>
            {columns.map((sym, i) => (
              <div
                key={sym}
                className="border-l px-4 py-3.5"
                style={{
                  background: i === 0 ? "var(--color-accent-soft)" : "#faf9f7",
                  borderColor: "var(--color-line-strong)",
                  borderBottomWidth: 1,
                  borderBottomStyle: "solid",
                }}
              >
                <div className="font-mono text-[13px] font-medium text-[var(--color-ink)]">{sym}</div>
                <div
                  className="mt-0.5 font-mono text-[10px]"
                  style={{ color: i === 0 ? "var(--color-accent)" : "#8a939e" }}
                >
                  {i === 0 ? "Your holding" : "Peer"}
                </div>
              </div>
            ))}
            {scorecard.map((row) => (
              <div key={row.label} className="contents">
                <div className="border-b px-4.5 py-3" style={{ background: "#faf9f7", borderColor: "var(--color-line-soft)" }}>
                  <div className="text-xs" style={{ color: "#3d4650" }}>
                    {row.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--color-muted-2)" }}>
                    {row.note}
                  </div>
                </div>
                {columns.map((sym) => {
                  const cell = row.cells.find((c) => c.symbol === sym);
                  return (
                    <div
                      key={sym}
                      className="border-b border-l px-4 py-3 font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]"
                      style={{ borderColor: "var(--color-line-soft)" }}
                    >
                      {cell ? formatCell(cell, row.unit) : <Value value={null} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-4.5 py-3 font-mono text-[10.5px]" style={{ background: "#faf9f7", color: "var(--color-muted-2)" }}>
        Quarterly figures are cohort flow aggregates, not valuation or performance measures. Cells marked
        unavailable are never treated as zero.
      </div>
    </div>
  );
}
