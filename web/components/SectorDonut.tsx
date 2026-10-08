import { computeSectorExposure, donutSlices, type HoldingRow } from "@/lib/portfolio";
import { pct } from "@/lib/format";

export function SectorDonut({ rows }: { rows: HoldingRow[] }) {
  const sectors = computeSectorExposure(rows);
  const slices = donutSlices(sectors);

  return (
    <div className="rounded-lg border bg-[var(--color-card)] p-4.5" style={{ borderColor: "var(--color-line)" }}>
      <div className="font-medium text-[13px] text-[var(--color-ink)]">Sector exposure</div>
      <div className="mt-1 text-[11px] text-[var(--color-muted)]">Share of cost basis</div>
      {rows.length === 0 ? (
        <div className="mt-3 text-[11.5px]" style={{ color: "var(--color-muted-2)" }}>
          Add holdings to see exposure.
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4.5">
          <svg viewBox="0 0 120 120" style={{ width: 120, height: 120, flex: "none" }}>
            {slices.map((s, i) => (
              <path key={i} d={s.d} fill={s.fill} />
            ))}
            <circle cx="60" cy="60" r="26" fill="var(--color-card)" />
          </svg>
          <div className="flex flex-1 flex-col gap-2">
            {sectors.map((s) => (
              <div key={s.name} className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs" style={{ color: "#3d4650" }}>
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.fill }} />
                  {s.name}
                </span>
                <span className="font-mono text-[11.5px] tabular-nums text-[var(--color-ink)]">{pct(s.fraction)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
