import type { Holding } from "@/lib/holdings/store";
import { holdingStatus, type HoldingStatus, type SavedRunLike } from "@/lib/flowStatus";
import { SHARES_PER_LOT } from "@/lib/holdings/store";
import type { ServePositionRecord, ServePriceHistoryRecord } from "@/lib/contract/types";

export interface HoldingRow extends Holding {
  name: string;
  sector: string;
  cost: number;
  /** null when the position's close is unavailable — never treated as zero. */
  mkt: number | null;
  pl: number | null;
  plPct: number | null;
  /** Review status from the latest saved Run Analyst pass — see lib/flowStatus.ts. */
  status: HoldingStatus;
}

/**
 * Positions are passed in rather than imported: they come from Supabase via
 * ResultsProvider, and keeping them an argument leaves this module pure and
 * directly testable.
 */
export function buildRows(
  holdings: Holding[],
  positions: ServePositionRecord[],
  /** Latest saved run per symbol; a symbol absent from it has not been reviewed. */
  runOf: (symbol: string) => SavedRunLike | undefined,
  /** Trade date of the currently scored components, per symbol. */
  currentTradeDateOf: (symbol: string) => string | null
): HoldingRow[] {
  const bySymbol = new Map(positions.map((p) => [p.symbol, p]));
  return holdings.map((h) => {
    const position = bySymbol.get(h.sym);
    const cost = h.lots * SHARES_PER_LOT * h.avg;
    const mkt =
      position && position.value_status === "AVAILABLE" && position.close !== null
        ? h.lots * SHARES_PER_LOT * position.close
        : null;
    const pl = mkt !== null ? mkt - cost : null;
    const plPct = pl !== null && cost > 0 ? pl / cost : null;
    return {
      ...h,
      name: position?.name ?? h.sym,
      sector: position?.sector ?? "Uncategorized",
      cost,
      mkt,
      pl,
      plPct,
      status: holdingStatus({ run: runOf(h.sym), currentTradeDate: currentTradeDateOf(h.sym), currentLots: h.lots }),
    };
  });
}

export interface Totals {
  cost: number;
  /** null when any held position's market value is unavailable. */
  mkt: number | null;
  pl: number | null;
  plPct: number | null;
  matchedCount: number;
  totalCount: number;
}

export function computeTotals(rows: HoldingRow[]): Totals {
  const cost = rows.reduce((sum, r) => sum + r.cost, 0);
  const matched = rows.filter((r) => r.mkt !== null);
  const allMatched = matched.length === rows.length && rows.length > 0;
  const mkt = allMatched ? matched.reduce((sum, r) => sum + (r.mkt ?? 0), 0) : null;
  const pl = mkt !== null ? mkt - cost : null;
  const plPct = pl !== null && cost > 0 ? pl / cost : null;
  return { cost, mkt, pl, plPct, matchedCount: matched.length, totalCount: rows.length };
}

export interface ValuePoint {
  trade_date: string;
  /** Null when any held symbol has no close that day — a gap, never a zero. */
  value: number | null;
}

export interface ValueSeries {
  points: ValuePoint[];
  /** Sessions where every held symbol had a close, out of sessions covered. */
  completeSessions: number;
  totalSessions: number;
  start: string | null;
  end: string | null;
}

/**
 * Portfolio market value on each session in the ingested window.
 *
 * A session where any held symbol is missing a close yields `null` for that
 * date rather than a partial sum — the same discipline `computeTotals` applies
 * to a missing close, and the reason the sparkline can honestly show a break
 * instead of a dip that never happened. Sessions are the union of dates any
 * held symbol traded on; a symbol absent from that union on a given day is what
 * makes the day incomplete.
 */
export function computeValueSeries(
  holdings: Holding[],
  history: ServePriceHistoryRecord[]
): ValueSeries {
  const held = holdings.filter((h) => h.lots > 0);
  const relevant = history.filter((h) => held.some((holding) => holding.sym === h.symbol));

  const closes = new Map<string, Map<string, number>>();
  const sessions = new Set<string>();
  for (const record of relevant) {
    const bySymbol = new Map<string, number>();
    for (const point of record.points) {
      bySymbol.set(point.trade_date, point.close);
      sessions.add(point.trade_date);
    }
    closes.set(record.symbol, bySymbol);
  }

  const dates = Array.from(sessions).sort();
  const points: ValuePoint[] = dates.map((trade_date) => {
    let total = 0;
    for (const holding of held) {
      const close = closes.get(holding.sym)?.get(trade_date);
      if (close === undefined) return { trade_date, value: null };
      total += holding.lots * SHARES_PER_LOT * close;
    }
    return { trade_date, value: held.length > 0 ? total : null };
  });

  return {
    points,
    completeSessions: points.filter((p) => p.value !== null).length,
    totalSessions: points.length,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

export interface SectorSlice {
  name: string;
  fraction: number;
  fill: string;
}

const SECTOR_PALETTE = [
  "var(--sector-1)",
  "var(--sector-2)",
  "var(--sector-3)",
  "var(--sector-4)",
  "var(--sector-5)",
  "var(--sector-6)",
];

export function computeSectorExposure(rows: HoldingRow[]): SectorSlice[] {
  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0) || 1;
  const bySector = new Map<string, number>();
  for (const row of rows) {
    bySector.set(row.sector, (bySector.get(row.sector) ?? 0) + row.cost);
  }
  return Array.from(bySector.entries())
    .map(([name, cost], i) => ({ name, fraction: cost / totalCost, fill: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }))
    .sort((a, b) => b.fraction - a.fraction);
}

/**
 * Arc paths for a pie/donut, starting at 12 o'clock and sweeping clockwise.
 *
 * A slice covering the whole chart needs its own branch: as one `A` command its
 * start and end points coincide, and the SVG spec omits such an arc entirely, so
 * the wedge below would collapse to a zero-area line and draw nothing. A
 * single-sector portfolio is exactly that case, so it is the common path, not an
 * edge case. Two stacked half-arcs give a real circle.
 */
export function donutSlices(slices: SectorSlice[], cx = 60, cy = 60, r = 54): { d: string; fill: string }[] {
  // `polar` already offsets by -90°, so 0 here is the top of the circle.
  let angle = 0;
  const polar = (deg: number): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  return slices.map((slice) => {
    const sweep = slice.fraction * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    // Tolerance rather than `>= 360`: a fraction that rounds to 0.9999999 would
    // otherwise fall through to the wedge and silently draw nothing.
    if (sweep >= 359.999) {
      return {
        fill: slice.fill,
        d: `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx},${cy + r} A${r},${r} 0 1 1 ${cx},${cy - r} Z`,
      };
    }
    const [x1, y1] = polar(start);
    const [x2, y2] = polar(end);
    const large = sweep > 180 ? 1 : 0;
    return {
      fill: slice.fill,
      d: `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`,
    };
  });
}
