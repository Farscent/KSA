interface PortfolioSparklineProps {
  cost: number;
  mkt: number | null;
}

/**
 * A short illustrative walk from cost basis to current market value. This is
 * NOT a price series from serve_flow_series — it exists purely as a visual
 * bridge between the two numbers already shown below it, and never states a
 * value that isn't also rendered as text nearby.
 */
export function PortfolioSparkline({ cost, mkt }: PortfolioSparklineProps) {
  const end = mkt ?? cost;
  const points: number[] = [];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let v = cost || 1;
  for (let i = 0; i < 30; i++) {
    v += (rnd() - 0.42) * ((cost || 1) * 0.002);
    points.push(v);
  }
  const blendFrom = 22;
  for (let i = blendFrom; i < 30; i++) {
    const t = (i - blendFrom) / (29 - blendFrom);
    points[i] = points[i] * (1 - t) + end * t;
  }
  points[29] = end;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((val, i) => `${((i / 29) * 300).toFixed(1)},${(80 - ((val - min) / range) * 64).toFixed(1)}`).join(" ");

  return (
    <div className="relative" style={{ height: 88 }}>
      <svg viewBox="0 0 300 88" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <line x1="0" y1="70" x2="300" y2="70" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
