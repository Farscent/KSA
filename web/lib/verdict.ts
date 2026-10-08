import type { ServeComponentsRecord } from "@/lib/contract/types";
import { crossedSignals, flowSignals } from "@/lib/flowStatus";

export type Verdict = "Healthy" | "Watch" | "Rebalance";

/**
 * A triage label over the three components, not a combined severity score:
 * per CLAUDE.md, concentration/breadth/persistence are never collapsed into
 * one number. This function only ever picks among three fixed labels — it
 * never blends the components' own numbers into a new one, and every label
 * still leaves the components displayed separately underneath it.
 *
 * Derived from the scored components alone (see lib/flowStatus.ts for the
 * cuts). It used to also require a hand-written fixture alert, which existed
 * for two symbols only, so every other holding was stuck on "Healthy".
 *
 * - nothing crossed (or nothing measurable): Healthy
 * - anything crossed: Watch
 * - concentration crossed on fully matched broker data: Rebalance
 */
export function computeVerdict(components: ServeComponentsRecord | null | undefined): Verdict {
  if (!components) return "Healthy";

  const signals = flowSignals(components);
  const crossed = crossedSignals(signals);
  if (crossed.length === 0) return "Healthy";

  const fullCoverage = components.coverage.completeness === "FULL";
  if (signals.concentration === true && fullCoverage) return "Rebalance";
  return "Watch";
}

/**
 * The verdict to show for a saved report. Recomputed from the components the
 * run saw whenever they are available, so reports saved while the verdict
 * still depended on the two-symbol fixture show the same label a fresh run
 * would; older rows without saved components keep the label they were saved with.
 */
export function savedVerdict(row: { verdict: Verdict; flow_components: ServeComponentsRecord | null }): Verdict {
  return row.flow_components ? computeVerdict(row.flow_components) : row.verdict;
}
