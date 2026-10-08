"use client";

import { useRouter } from "next/navigation";
import type { HoldingRow } from "@/lib/portfolio";
import { StatusChip } from "@/components/StatusChip";
import { Value } from "@/components/Value";

/**
 * Column widths are sized to the widest realistic IDR figure rather than to the
 * demo's own numbers: `Rp 2.000.000.000` is 16 characters (~120px at 12.5px
 * mono), so the money columns carry headroom. An overflowing cell here has no
 * clipping to stop it and would slide underneath the opaque status chip, which
 * silently truncates a figure instead of visibly breaking — hence the margin.
 */
const COLUMNS = "72px 1fr 40px 124px 124px 144px 172px";
/** Fixed columns (676px) + six 16px gaps + 28px horizontal padding + room for the sector name. */
const MIN_WIDTH = 880;

export function OverviewTable({ rows }: { rows: HoldingRow[] }) {
  const router = useRouter();

  return (
    <div
      className="rounded-lg border overflow-hidden bg-[var(--color-card)] flex flex-col"
      style={{ borderColor: "var(--color-line)" }}
    >
      {/* One horizontal scroll container around both header and body: separate
          ones scroll independently, leaving the headers behind when the rows
          are dragged sideways. */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div
          className="sticky top-0 z-10 grid gap-4 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
          style={{
            gridTemplateColumns: COLUMNS,
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-line-strong)",
            letterSpacing: "0.09em",
            minWidth: MIN_WIDTH,
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
        {rows.length === 0 && (
          <div className="px-4.5 py-5.5 text-center text-xs" style={{ color: "var(--color-muted-2)" }}>
            No holdings to review yet.
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.sym}
            onClick={() => router.push(`/${r.sym}`)}
            className="grid items-center gap-4 border-b px-3.5 py-3.5"
            style={{
              gridTemplateColumns: COLUMNS,
              borderColor: "var(--color-line-soft)",
              minWidth: MIN_WIDTH,
              cursor: "pointer",
              background: r.status.kind === "reviewed" && r.status.crossed.length > 0 ? "#fbfcfd" : "var(--color-card)",
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
            {/* Amount and percentage stack rather than share a line: together
                they exceed any sensible column width, and the percentage is the
                part that gets pushed out of sight. */}
            <div className="text-right font-mono text-[12.5px] font-medium tabular-nums text-[var(--color-ink)] whitespace-nowrap">
              <div>
                <Value value={r.pl} format="signedIdr" />
              </div>
              {r.plPct !== null && (
                <div className="font-mono text-[10.5px] font-normal" style={{ color: "var(--color-muted)" }}>
                  <Value value={r.plPct} format="signedPct" />
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <StatusChip status={r.status} />
            </div>
          </div>
        ))}
      </div>
      <div className="px-4.5 py-3 text-[11.5px] shrink-0" style={{ background: "#faf9f7", color: "var(--color-muted)" }}>
        Any row opens its evidence report. The status names which broker-flow components crossed their own
        baseline in the last Run Analyst pass, or{" "}
        <span className="font-mono font-medium" style={{ color: "#3d4650" }}>
          No threshold crossed
        </span>{" "}
        {"—"} not an endorsement. <span className="font-mono">Not reviewed</span> means no run yet;{" "}
        <span className="font-mono">Outdated</span> means the data date or your position moved since the last run.
      </div>
    </div>
  );
}
