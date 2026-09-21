"use client";

import { useRouter } from "next/navigation";
import type { HoldingRow } from "@/lib/portfolio";
import { StatusChip } from "@/components/StatusChip";
import { Value } from "@/components/Value";

export function OverviewTable({ rows }: { rows: HoldingRow[] }) {
  const router = useRouter();

  return (
    <div
      className="rounded-lg border overflow-hidden bg-[var(--color-card)] flex flex-col"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="overflow-x-auto shrink-0">
        <div
          className="grid gap-4 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
          style={{
            gridTemplateColumns: "72px 1fr 44px 116px 116px 132px 88px",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-line-strong)",
            letterSpacing: "0.09em",
            minWidth: 680,
          }}
        >
          <div>Symbol</div>
          <div>Sector</div>
          <div className="text-right">Lots</div>
          <div className="text-right">Cost basis</div>
          <div className="text-right">Mkt value</div>
          <div className="text-right">Unrealized</div>
          <div className="text-right">Status</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {rows.length === 0 && (
          <div className="px-4.5 py-5.5 text-center text-xs" style={{ color: "var(--color-muted-2)" }}>
            No holdings to review yet.
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.sym}
            onClick={() => r.flagged && router.push(`/${r.sym}`)}
            className="grid items-center gap-4 border-b px-3.5 py-3.5"
            style={{
              gridTemplateColumns: "72px 1fr 44px 116px 116px 132px 88px",
              borderColor: "var(--color-line-soft)",
              minWidth: 680,
              cursor: r.flagged ? "pointer" : "default",
              background: r.flagged ? "#fbfcfd" : "var(--color-card)",
            }}
          >
            <div className="font-mono text-[12.5px] font-medium text-[var(--color-ink)]">{r.sym}</div>
            <div className="text-[12.5px]" style={{ color: "#3d4650" }}>
              {r.sector}
            </div>
            <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{r.lots}</div>
            <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)] whitespace-nowrap">
              <Value value={r.cost} format="idr" />
            </div>
            <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)] whitespace-nowrap">
              <Value value={r.mkt} format="idr" />
            </div>
            <div className="text-right font-mono text-[12.5px] font-medium tabular-nums text-[var(--color-ink)] whitespace-nowrap">
              <Value value={r.pl} format="signedIdr" />
              {r.plPct !== null && (
                <span className="ml-1 font-mono text-[10.5px] font-normal" style={{ color: "var(--color-muted)" }}>
                  {"·"} <Value value={r.plPct} format="signedPct" />
                </span>
              )}
            </div>
            <div className="flex justify-end">
              <StatusChip flagged={r.flagged} />
            </div>
          </div>
        ))}
      </div>
      <div className="px-4.5 py-3 text-[11.5px] shrink-0" style={{ background: "#faf9f7", color: "var(--color-muted)" }}>
        Rows flagged{" "}
        <span className="font-mono font-medium" style={{ color: "var(--color-accent)" }}>
          Review
        </span>{" "}
        open an evidence report.{" "}
        <span className="font-mono font-medium" style={{ color: "#3d4650" }}>
          Stable
        </span>{" "}
        means no threshold was crossed this run {"—"} it is not an endorsement.
      </div>
    </div>
  );
}
