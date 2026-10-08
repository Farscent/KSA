import type { ExcludedCandidate } from "@/lib/contract/types";

export function ExcludedTable({ excluded }: { excluded: ExcludedCandidate[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-[var(--color-card)]" style={{ borderColor: "var(--color-line)" }}>
      <div
        className="flex flex-wrap items-baseline justify-between gap-1.5 border-b px-4.5 py-3.5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-line-strong)" }}
      >
        <span className="font-medium text-[13px] text-[var(--color-ink)]">
          Excluded candidates <span className="font-mono text-[11.5px] font-normal text-[var(--color-muted)]">{"·"} {excluded.length}</span>
        </span>
        <span className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          Screened against the same session window
        </span>
      </div>
      {excluded.map((x) => (
        <div
          key={x.symbol}
          className="grid items-center gap-3.5 border-b px-4.5 py-3.5"
          style={{ gridTemplateColumns: "100px 220px 1fr 240px", borderColor: "var(--color-line-soft)" }}
        >
          <div className="font-mono text-[12.5px] font-medium" style={{ color: "#6a7480" }}>
            {x.symbol}
          </div>
          <div className="text-[12.5px]" style={{ color: "#6a7480" }}>
            {x.name}
          </div>
          <div className="text-xs" style={{ color: "#4a535e" }}>
            {x.reason_text}
          </div>
          <div className="text-right font-mono text-[11px]" style={{ color: "#8a939e" }}>
            {x.detail}
          </div>
        </div>
      ))}
    </div>
  );
}
