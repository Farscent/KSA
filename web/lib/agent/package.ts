/**
 * `ResearchPackage` — the only thing the LLM ever sees for a symbol.
 *
 * Supersedes `lib/llm/package.ts`, which carried broker flow alone. Same two
 * rules, now across nine blocks instead of four:
 *
 *   - every figure is already computed (see lib/agent/metrics.ts);
 *   - the model may only cite a path that `allowedGroundedPaths` emits, and an
 *     UNAVAILABLE block emits none — so "not measured" can never be narrated
 *     as "zero".
 */

import type { ProvenanceEntry } from "@/lib/sectors/cache";
import type { Verdict } from "@/lib/verdict";
import type {
  ServeComponentsRecord,
  ServeFlowSeriesRecord,
} from "@/lib/contract/types";
import type {
  Dividend,
  Financials,
  Future,
  Identity,
  NearbyContext,
  Peers,
  ResearchBlock,
  Subsector,
  Valuation,
} from "@/lib/research/types";
import type { Measure, PeerMetrics, PositionMetrics, ValuationMetrics } from "@/lib/agent/metrics";

export type StepStatus = "done" | "failed" | "skipped";

export interface StepTrace {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  credits: number;
  duration_ms: number;
}

export interface ResearchPackage {
  symbol: string;
  trade_date: string;
  verdict: Verdict;

  /** The headline. Real scoring from sectors/scoring.py, via Supabase. */
  flow: {
    components: ServeComponentsRecord | null;
    series: ServeFlowSeriesRecord[];
  };

  position: PositionMetrics;
  identity: ResearchBlock<Identity>;
  valuation: ResearchBlock<Valuation>;
  valuation_metrics: ValuationMetrics;
  financials: ResearchBlock<Financials>;
  future: ResearchBlock<Future>;
  dividend: ResearchBlock<Dividend>;
  peers: ResearchBlock<Peers>;
  peer_metrics: PeerMetrics;
  subsector: ResearchBlock<Subsector>;
  context: ResearchBlock<NearbyContext>;
  /**
   * Macro and policy context. Permanently UNAVAILABLE for now: the app has no
   * web-search provider, and a macro figure without a source URL is exactly
   * the kind of number this system must never state. Declared rather than
   * omitted so the report shows an honest gap instead of a silent one.
   */
  macro: ResearchBlock<never>;

  provenance: ProvenanceEntry[];
  steps: StepTrace[];
  credits_used: number;
}

const COMPONENT_FIELDS: Record<string, readonly string[]> = {
  concentration: ["share", "baseline_share", "top_n", "band", "band_count"],
  breadth: ["changed", "active", "share", "baseline_share"],
  persistence: ["same_direction", "of_sessions", "longest_run"],
  coverage: ["matched_share", "cohorts_available", "cohorts_total", "completeness"],
};

/** Shared with lib/agent/portfolio.ts's allowedPortfolioPaths — same walk,
 * same "an UNAVAILABLE Measure contributes no path" discipline. */
export function isMeasure(value: unknown): value is Measure<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    "value_status" in (value as Record<string, unknown>) &&
    "value" in (value as Record<string, unknown>)
  );
}

/**
 * Emits a leaf path for every field the model is allowed to cite.
 *
 * Replaces the old hardcoded four-block map, which did not scale past
 * `serve_components`. The walk is deliberately shallow-ish and driven by
 * `value_status`: an UNAVAILABLE block or Measure contributes nothing, which
 * is what stops an unmeasured figure being rendered as a zero.
 */
export function allowedGroundedPaths(pkg: ResearchPackage): Set<string> {
  const paths = new Set<string>();

  // Broker flow keeps its established contract paths verbatim, so narration
  // written against the old package still validates unchanged.
  const components = pkg.flow.components;
  if (components) {
    for (const [block, fields] of Object.entries(COMPONENT_FIELDS)) {
      const value = components[block as keyof ServeComponentsRecord];
      if (value && typeof value === "object" && (value as { value_status?: string }).value_status === "AVAILABLE") {
        for (const field of fields) paths.add(`serve_components.${block}.${field}`);
      }
    }
  }
  if (pkg.flow.series.some((row) => row.value_status === "AVAILABLE")) {
    paths.add("serve_flow_series.points");
  }

  // Measure-valued groups: one path per AVAILABLE measure.
  const measureGroups: Record<string, Record<string, unknown>> = {
    position: pkg.position as unknown as Record<string, unknown>,
    valuation_metrics: pkg.valuation_metrics as unknown as Record<string, unknown>,
    peer_metrics: pkg.peer_metrics as unknown as Record<string, unknown>,
  };
  for (const [group, fields] of Object.entries(measureGroups)) {
    for (const [name, value] of Object.entries(fields)) {
      if (isMeasure(value) && value.value_status === "AVAILABLE") paths.add(`${group}.${name}`);
    }
  }

  // Research blocks: one path per non-null field of an AVAILABLE block.
  const blocks: Record<string, ResearchBlock<unknown>> = {
    identity: pkg.identity,
    valuation: pkg.valuation,
    financials: pkg.financials,
    future: pkg.future,
    dividend: pkg.dividend,
    peers: pkg.peers,
    subsector: pkg.subsector,
    context: pkg.context,
    macro: pkg.macro,
  };
  for (const [name, block] of Object.entries(blocks)) {
    if (block.value_status !== "AVAILABLE" || !block.data) continue;
    if (typeof block.data !== "object") {
      paths.add(name);
      continue;
    }
    for (const [field, value] of Object.entries(block.data as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      paths.add(`${name}.${field}`);
    }
  }

  // The peer exclusion list is evidence in its own right: it is how the report
  // says "these candidates did not qualify, and here is why".
  if (pkg.peer_metrics.excluded.length > 0) paths.add("peer_metrics.excluded");

  return paths;
}
