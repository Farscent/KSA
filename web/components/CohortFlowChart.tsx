import type { ServeFlowSeriesRecord } from "@/lib/contract/types";

interface CohortFlowChartProps {
  series: ServeFlowSeriesRecord[];
}

const COHORT_STYLE: Record<string, { stroke: string; width: number }> = {
  institutional: { stroke: "var(--color-accent)", width: 2.25 },
  retail: { stroke: "#8aa8bc", width: 1.75 },
  mixed: { stroke: "#b9bfc7", width: 1.5 },
};

export function CohortFlowChart({ series }: CohortFlowChartProps) {
  const plotted = series.filter((s) => s.cohort !== "unknown" && s.value_status === "AVAILABLE");
  const allValues = plotted.flatMap((s) => s.points.map((p) => p.cumulative_net_value));
  const min = Math.min(0, ...allValues, -1);
  const max = Math.max(0, ...allValues, 1);
  const range = max - min || 1;
  const yFor = (v: number) => 200 - ((v - min) / range) * 200;
  const pointCount = Math.max(...plotted.map((s) => s.points.length), 1);
  const ptsFor = (s: ServeFlowSeriesRecord) =>
    s.points.map((p, i) => `${((i / (pointCount - 1 || 1)) * 1000).toFixed(1)},${yFor(p.cumulative_net_value).toFixed(1)}`).join(" ");

  // Six labels evenly spaced across the same linear scale the chart itself uses,
  // top (max) to bottom (min) — must match yFor's mapping, not an independent guess.
  const yLabels = Array.from({ length: 6 }, (_, i) => max - (i / 5) * range);

  return (
    <div className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: "64px 1fr" }}>
      <div
        className="flex flex-col justify-between text-right font-mono text-[10px]"
        style={{ color: "var(--color-muted-2)", height: 200, padding: "2px 0" }}
      >
        {yLabels.map((v, i) => (
          <span key={i}>{formatAxis(v)}</span>
        ))}
      </div>
      <div className="relative border-l border-b" style={{ height: 200, borderColor: "var(--color-line-strong)" }}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1="0" y1={yFor(0)} x2="1000" y2={yFor(0)} stroke="#b9bfc7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {plotted.map((s) => (
            <polyline
              key={s.cohort}
              points={ptsFor(s)}
              fill="none"
              stroke={COHORT_STYLE[s.cohort]?.stroke ?? "#999"}
              strokeWidth={COHORT_STYLE[s.cohort]?.width ?? 1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function formatAxis(v: number): string {
  const millions = v / 1_000_000;
  if (millions === 0) return "0";
  const sign = millions > 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(millions))} M`;
}
