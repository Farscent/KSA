/**
 * Price header figures, derived only from the closes the batch ingested.
 * Descriptive: no forecast, no signal. A period with too few sessions is
 * `null`, never zero.
 */
import type { PricePoint } from "@/lib/contract/types";

export interface Performance {
  label: "1W" | "1M" | "Window";
  /** Sessions between the compared closes. */
  sessions: number;
  /** Fractional change (0.05 = +5%); null when there are not enough sessions. */
  change: number | null;
}

export interface PriceOverview {
  last: PricePoint;
  dayChange: { abs: number; fraction: number } | null;
  performance: Performance[];
  windowHigh: number;
  windowLow: number;
  sessions: number;
  from: string;
  to: string;
}

const LOOKBACKS: { label: "1W" | "1M"; sessions: number }[] = [
  { label: "1W", sessions: 5 },
  { label: "1M", sessions: 21 },
];

function changeOver(points: PricePoint[], back: number): number | null {
  if (points.length <= back) return null;
  const then = points[points.length - 1 - back].close;
  if (!(then > 0)) return null;
  return points[points.length - 1].close / then - 1;
}

export function priceOverview(points: PricePoint[]): PriceOverview | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const closes = points.map((p) => p.close);

  return {
    last,
    dayChange: prev && prev.close > 0 ? { abs: last.close - prev.close, fraction: last.close / prev.close - 1 } : null,
    performance: [
      ...LOOKBACKS.map(({ label, sessions }) => ({ label, sessions, change: changeOver(points, sessions) })),
      { label: "Window" as const, sessions: points.length - 1, change: changeOver(points, points.length - 1) },
    ],
    windowHigh: Math.max(...closes),
    windowLow: Math.min(...closes),
    sessions: points.length,
    from: points[0].trade_date,
    to: last.trade_date,
  };
}
