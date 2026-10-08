import type { ServeAlertEvidenceRecord } from "@/lib/contract/types";
import { Value } from "@/components/Value";
import { signedIdr } from "@/lib/format";

const COHORT_LABEL: Record<string, string> = {
  institutional: "Institutional",
  retail: "Retail",
  mixed: "Mixed",
  unknown: "Unknown",
};

const ORDER = ["institutional", "retail", "mixed", "unknown"];

export function CohortTable({ evidence }: { evidence: ServeAlertEvidenceRecord[] }) {
  const rows = [...evidence].sort((a, b) => ORDER.indexOf(a.cohort) - ORDER.indexOf(b.cohort));
  const totalMatched = rows
    .filter((r) => r.value_status === "AVAILABLE")
    .reduce((sum, r) => sum + (r.buy_value ?? 0) + (r.sell_value ?? 0), 0);

  return (
    <div className="mt-4.5 overflow-hidden rounded-md border" style={{ borderColor: "var(--color-line-strong)" }}>
      <div
        className="grid gap-2.5 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
        style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", background: "var(--color-card)", borderBottom: "1px solid var(--color-line-strong)", letterSpacing: "0.09em" }}
      >
        <div>Cohort</div>
        <div className="text-right">Buy value</div>
        <div className="text-right">Sell value</div>
        <div className="text-right">Net</div>
        <div className="text-right">Share of matched</div>
      </div>
      {rows.map((r) => {
        const available = r.value_status === "AVAILABLE";
        const share = available && totalMatched > 0 ? ((r.buy_value ?? 0) + (r.sell_value ?? 0)) / totalMatched : null;
        const fg = available ? "#3d4650" : "var(--color-muted-2)";
        return (
          <div
            key={r.cohort}
            className="grid items-center gap-2.5 border-b px-3.5 py-2.5"
            style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", borderColor: "var(--color-line-soft)", background: available ? "var(--color-card)" : "#faf9f7" }}
          >
            <div className="text-xs" style={{ color: fg }}>
              {COHORT_LABEL[r.cohort]}
            </div>
            <div className="text-right font-mono text-xs tabular-nums" style={{ color: fg }}>
              <Value value={r.buy_value} format="idr" />
            </div>
            <div className="text-right font-mono text-xs tabular-nums" style={{ color: fg }}>
              <Value value={r.sell_value} format="idr" />
            </div>
            <div className="text-right font-mono text-xs font-medium tabular-nums" style={{ color: available ? "var(--color-ink)" : "var(--color-muted-2)" }}>
              {available ? signedIdr(r.net_value as number) : "unavailable"}
            </div>
            <div className="text-right font-mono text-xs tabular-nums" style={{ color: fg }}>
              <Value value={share} format="pct" />
            </div>
          </div>
        );
      })}
      <div className="px-3.5 py-2.5 font-mono text-[10.5px]" style={{ background: "#faf9f7", color: "var(--color-muted-2)" }}>
        Unknown cohort is rendered as unavailable, not as zero. Percentages are of matched value only.
      </div>
    </div>
  );
}
