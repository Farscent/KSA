/**
 * The one-screen summary of a saved report, assembled in code from the fact
 * rows each section already holds — no model call, no new fetch.
 *
 * Concentration, breadth and persistence stay separate rows, and the standouts
 * are listed in report order, never re-ranked by size: ordering unlike measures
 * against each other would be a combined score by another name.
 *
 * Pure functions, no `server-only`: unit-tested.
 */
import type { FactRow } from "@/lib/agent/display";

interface SectionLike {
  id: string;
  headline?: string | null;
  rows?: FactRow[];
  bullets?: string[];
}

export const MAX_STANDOUTS = 3;

export interface SymbolSummary {
  /** The broker-flow headline — the finding the page leads with. */
  finding: string | null;
  /** Flow rows: concentration, breadth, persistence, data coverage. */
  components: FactRow[];
  standouts: FactRow[];
  moreStandouts: number;
  /** Areas the report could not measure. */
  unmeasured: number;
}

/** Null for reports saved before the table format (no section has rows). */
export function summarise(sections: SectionLike[]): SymbolSummary | null {
  if (!sections.some((s) => (s.rows?.length ?? 0) > 0)) return null;

  const flow = sections.find((s) => s.id === "flow_structure");
  const risks = sections.find((s) => s.id === "risks");
  const components = flow?.rows ?? [];
  const shown = new Set(components.map((r) => r.label));

  const candidates = (risks?.rows ?? []).filter((r) => r.tone === "differs" && !shown.has(r.label));
  return {
    finding: flow?.headline ?? null,
    components,
    standouts: candidates.slice(0, MAX_STANDOUTS),
    moreStandouts: Math.max(0, candidates.length - MAX_STANDOUTS),
    unmeasured: risks?.bullets?.length ?? 0,
  };
}
