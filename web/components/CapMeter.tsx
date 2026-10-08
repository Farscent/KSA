import { HOLDINGS_CAP } from "@/lib/holdings/store";

export function CapMeter({ count }: { count: number }) {
  const pct = Math.min(100, (count / HOLDINGS_CAP) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="font-medium text-sm text-[var(--color-ink)]">
          Holdings <span className="font-mono text-xs font-normal text-[var(--color-muted)]">{"·"} {count} of {HOLDINGS_CAP}</span>
        </div>
      </div>
      <div className="mt-2.5 h-[3px] rounded overflow-hidden" style={{ background: "var(--color-line-strong)" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: "var(--color-accent)" }} />
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Cap of {HOLDINGS_CAP} holdings keeps each review within the broker-data coverage window.
      </div>
      {count >= HOLDINGS_CAP && (
        <div className="mt-2.5 text-[11px]" style={{ color: "var(--color-warn)" }}>
          Cap reached {"—"} delete a holding to add another.
        </div>
      )}
    </div>
  );
}
