import type { Holding } from "@/lib/holdings/store";
import { getPosition, isFlagged } from "@/lib/data/source";
import { SHARES_PER_LOT } from "@/lib/holdings/store";

export interface HoldingRow extends Holding {
  name: string;
  sector: string;
  cost: number;
  /** null when the position's close is unavailable — never treated as zero. */
  mkt: number | null;
  pl: number | null;
  plPct: number | null;
  flagged: boolean;
}

export function buildRows(holdings: Holding[]): HoldingRow[] {
  return holdings.map((h) => {
    const position = getPosition(h.sym);
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
      flagged: isFlagged(h.sym),
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

/** Arc path for a pie/donut slice, ported from the prototype's polar() helper. */
export function donutSlices(slices: SectorSlice[], cx = 60, cy = 60, r = 54): { d: string; fill: string }[] {
  let angle = -90;
  const polar = (deg: number): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  return slices.map((slice) => {
    const sweep = slice.fraction * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const [x1, y1] = polar(start);
    const [x2, y2] = polar(end);
    const large = sweep > 180 ? 1 : 0;
    return {
      fill: slice.fill,
      d: `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`,
    };
  });
}
