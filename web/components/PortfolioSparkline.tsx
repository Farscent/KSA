import type { ValueSeries } from "@/lib/portfolio";
import { idr } from "@/lib/format";

/**
 * Portfolio market value across the ingested close window.
 *
 * Every plotted point is a real sum of `lots × 100 × close` on a session the
 * batch actually ingested. Sessions where a held symbol had no close are gaps:
 * the line breaks rather than dipping through a value that was never observed.
 */
export function PortfolioSparkline({ series }: { series: ValueSeries }) {
  const values = series.points.map((p) => p.value).filter((v): v is number => v !== null);

  if (values.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md"
        style={{ height: 88, background: "var(--color-surface)", color: "var(--color-muted-2)" }}
      >
        <span className="font-mono text-[11px]">
          {series.totalSessions === 0
            ? "No price history ingested yet"
            : "Not enough complete sessions to plot"}
        </span>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lastIndex = series.points.length - 1;
  const x = (i: number) => (lastIndex === 0 ? 0 : (i / lastIndex) * 300);
  const y = (value: number) => 80 - ((value - min) / range) * 64;

  // Split into runs of consecutive plottable points so a gap renders as a
  // break in the line, not as a straight segment across missing sessions.
  const runs: string[] = [];
  let current: string[] = [];
  for (const [i, point] of series.points.entries()) {
    if (point.value === null) {
      if (current.length > 1) runs.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${x(i).toFixed(1)},${y(point.value).toFixed(1)}`);
  }
  if (current.length > 1) runs.push(current.join(" "));

  const first = values[0];
  const last = values[values.length - 1];

  return (
    <div className="relative" style={{ height: 88 }}>
      <svg
        viewBox="0 0 300 88"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Portfolio value from ${idr(first)} on ${series.start} to ${idr(last)} on ${series.end}`}
      >
        <line
          x1="0"
          y1={y(first).toFixed(1)}
          x2="300"
          y2={y(first).toFixed(1)}
          stroke="var(--color-line-strong)"
          strokeWidth="1"
          strokeDasharray="3,3"
          vectorEffect="non-scaling-stroke"
        />
        {runs.map((points, i) => (
          <polyline
            key={i}
            points={points}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
