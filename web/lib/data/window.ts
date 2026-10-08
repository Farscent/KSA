import type { ServeFlowSeriesRecord } from "@/lib/contract/types";

export interface FlowWindow {
  sessions: number;
  start: string;
  end: string;
}

/** The scored window, read off the real flow series rather than a run fixture. */
export function flowWindow(series: ServeFlowSeriesRecord[]): FlowWindow | null {
  const widest = series.reduce<ServeFlowSeriesRecord | null>(
    (best, s) => (s.points.length > (best?.points.length ?? 0) ? s : best),
    null
  );
  if (!widest) return null;
  const dates = widest.points.map((p) => p.trade_date).sort();
  return { sessions: dates.length, start: dates[0], end: dates[dates.length - 1] };
}
