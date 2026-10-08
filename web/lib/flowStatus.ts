import type { ServeComponentsRecord } from "@/lib/contract/types";
import { SHARE_TOLERANCE } from "@/lib/agent/display";

/**
 * Whether each broker-flow component crossed its own threshold, derived from
 * the scored `serve_components` row. Three independent signals — never summed
 * or ranked, per CLAUDE.md's founding rule. `null` means "not measurable",
 * which is deliberately different from `false` ("measured, not crossed").
 *
 * Every cut is a named constant here so the whole rule set is auditable in one
 * place; none of them is a model judgment.
 */
export type SignalName = "concentration" | "breadth" | "persistence";

export interface FlowSignals {
  concentration: boolean | null;
  breadth: boolean | null;
  persistence: boolean | null;
}

/** Concentration counts as elevated in the top 40% of its own band range (e.g. band 3 of 5). */
export const BAND_ELEVATED_CUT = 0.6;
/** Persistence counts as crossed when at least this share of the trailing sessions flowed the same way. */
export const PERSISTENCE_CUT = 0.6;

export const SIGNAL_LABEL: Record<SignalName, string> = {
  concentration: "Concentration",
  breadth: "Breadth",
  persistence: "Persistence",
};

const SIGNAL_ORDER: SignalName[] = ["concentration", "breadth", "persistence"];

function concentrationCrossed(c: ServeComponentsRecord["concentration"]): boolean | null {
  if (c.value_status !== "AVAILABLE" || c.band === null || c.band_count === null || c.band_count <= 0) return null;
  return c.band / c.band_count >= BAND_ELEVATED_CUT;
}

function breadthCrossed(b: ServeComponentsRecord["breadth"]): boolean | null {
  if (b.value_status !== "AVAILABLE" || b.share === null || b.baseline_share === null) return null;
  return b.share - b.baseline_share > SHARE_TOLERANCE;
}

function persistenceCrossed(p: ServeComponentsRecord["persistence"]): boolean | null {
  if (p.value_status !== "AVAILABLE" || p.same_direction === null || p.of_sessions === null || p.of_sessions <= 0) return null;
  return p.same_direction / p.of_sessions >= PERSISTENCE_CUT;
}

export function flowSignals(components: ServeComponentsRecord | null | undefined): FlowSignals {
  if (!components) return { concentration: null, breadth: null, persistence: null };
  return {
    concentration: concentrationCrossed(components.concentration),
    breadth: breadthCrossed(components.breadth),
    persistence: persistenceCrossed(components.persistence),
  };
}

export function crossedSignals(signals: FlowSignals): SignalName[] {
  return SIGNAL_ORDER.filter((name) => signals[name] === true);
}

export function unmeasuredSignals(signals: FlowSignals): SignalName[] {
  return SIGNAL_ORDER.filter((name) => signals[name] === null);
}

/** The slice of a saved Run Analyst row that status needs. */
export interface SavedRunLike {
  trade_date: string;
  /** `package.flow.components` as the run saw it; null for runs saved before it was selected. */
  flow_components: ServeComponentsRecord | null;
  /** `package.position.lots.value` as the run saw it. */
  lots: number | null;
}

export type HoldingStatus =
  | { kind: "not_reviewed" }
  | { kind: "outdated"; reason: string; signals: FlowSignals }
  | { kind: "reviewed"; signals: FlowSignals; crossed: SignalName[]; unmeasured: SignalName[] };

/**
 * Status of one holding. It is read from the saved run's own components, so it
 * reflects what the analyst actually looked at; it turns `outdated` when the
 * scored data date or the held lots have moved since then.
 */
export function holdingStatus(input: {
  run: SavedRunLike | undefined;
  currentTradeDate: string | null;
  currentLots: number | null;
}): HoldingStatus {
  const { run, currentTradeDate, currentLots } = input;
  if (!run) return { kind: "not_reviewed" };

  const signals = flowSignals(run.flow_components);
  if (currentTradeDate !== null && run.trade_date !== currentTradeDate) {
    return { kind: "outdated", reason: `Data moved from ${run.trade_date} to ${currentTradeDate}`, signals };
  }
  if (currentLots !== null && run.lots !== null && run.lots !== currentLots) {
    return { kind: "outdated", reason: `Position changed from ${run.lots} to ${currentLots} lots`, signals };
  }
  return { kind: "reviewed", signals, crossed: crossedSignals(signals), unmeasured: unmeasuredSignals(signals) };
}
