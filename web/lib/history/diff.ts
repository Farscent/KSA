/**
 * What changed between two Run Analyst passes, and per-run component counts.
 * Pure: takes already-saved digests, never reads data or does any scoring of
 * its own beyond lib/flowStatus.ts's thresholds.
 *
 * Counts are kept per component and never summed — "3 holdings crossed
 * something" would hide whether that was concentration or persistence.
 */
import { crossedSignals, flowSignals, SIGNAL_LABEL, type SignalName } from "@/lib/flowStatus";
import type { ServeComponentsRecord } from "@/lib/contract/types";

export interface RunDigest {
  symbol: string;
  crossed: SignalName[];
}

export function digestOfSaved(row: { symbol: string; flow_components: ServeComponentsRecord | null }): RunDigest {
  return { symbol: row.symbol, crossed: crossedSignals(flowSignals(row.flow_components)) };
}

export type ComponentCounts = Record<SignalName, number>;

/** Holdings that crossed each component, counted separately. */
export function componentCounts(digests: RunDigest[]): ComponentCounts {
  const counts: ComponentCounts = { concentration: 0, breadth: 0, persistence: 0 };
  for (const d of digests) for (const name of d.crossed) counts[name]++;
  return counts;
}

export interface RunDiff {
  added: string[];
  removed: string[];
  changed: { symbol: string; from: SignalName[]; to: SignalName[] }[];
}

export function diffRuns(current: RunDigest[], previous: RunDigest[]): RunDiff {
  const before = new Map(previous.map((d) => [d.symbol, d]));
  const after = new Map(current.map((d) => [d.symbol, d]));

  const added = current.filter((d) => !before.has(d.symbol)).map((d) => d.symbol).sort();
  const removed = previous.filter((d) => !after.has(d.symbol)).map((d) => d.symbol).sort();
  const changed: RunDiff["changed"] = [];
  for (const d of current) {
    const prev = before.get(d.symbol);
    if (!prev) continue;
    const same = prev.crossed.length === d.crossed.length && prev.crossed.every((n) => d.crossed.includes(n));
    if (!same) changed.push({ symbol: d.symbol, from: prev.crossed, to: d.crossed });
  }
  changed.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { added, removed, changed };
}

function names(list: SignalName[]): string {
  return list.length === 0 ? "nothing crossed" : list.map((n) => SIGNAL_LABEL[n]).join(" + ");
}

/** Plain lines for the list page; a single "no change" line when nothing differs. */
export function describeDiff(diff: RunDiff): string[] {
  const lines: string[] = [];
  if (diff.added.length > 0) lines.push(`Added: ${diff.added.join(", ")}`);
  if (diff.removed.length > 0) lines.push(`Removed: ${diff.removed.join(", ")}`);
  for (const c of diff.changed) lines.push(`${c.symbol}: ${names(c.from)} → ${names(c.to)}`);
  return lines.length > 0 ? lines : ["No change from the previous run"];
}
