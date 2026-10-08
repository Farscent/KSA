/**
 * `PortfolioPackage` — the cross-holding digest the portfolio summary is
 * written from.
 *
 * Built in code from the per-symbol `ResearchPackage`s a Run Analyst pass
 * already produced — this costs zero extra Sectors credits, it is a second
 * pass over data already in hand. Same two rules as `lib/agent/package.ts`:
 * every figure here is already computed, and the model may only cite a path
 * `allowedPortfolioPaths` emits.
 */

import { isMeasure, type ResearchPackage, type StepTrace } from "@/lib/agent/package";
import {
  computeExposure,
  computeStandouts,
  computeTotals,
  computeVerdictCounts,
  digestOf,
  type ComponentStandouts,
  type ExposureMetrics,
  type HoldingDigest,
  type PortfolioTotals,
  type VerdictCounts,
} from "@/lib/agent/portfolioMetrics";
import type { ProvenanceEntry } from "@/lib/sectors/cache";

export interface NotMeasuredEntry {
  symbol: string;
  blocks: string[];
}

export interface PortfolioPackage {
  as_of: string;
  window_sessions: number | null;
  holdings: HoldingDigest[];
  totals: PortfolioTotals;
  /** Three independent lists — never merged into one ranking. */
  standouts: ComponentStandouts;
  exposure: ExposureMetrics;
  verdict_counts: VerdictCounts;
  not_measured: NotMeasuredEntry[];
  provenance: ProvenanceEntry[];
  steps: StepTrace[];
  credits_used: number;
  duration_ms: number;
}

/**
 * Builds the portfolio package from the per-symbol packages a run collected.
 * Symbols that failed their own Run Analyst pass are simply absent — the
 * caller decides whether to still summarise the rest.
 */
export function buildPortfolioPackage(
  packages: ResearchPackage[],
  windowSessions: number | null,
  durationMs: number
): PortfolioPackage {
  const holdings = packages.map(digestOf);

  const scoredBasis = new Map<string, "MEASURED" | "EXAMPLE_VALUE" | null>(
    packages.map((p) => [p.symbol, p.flow.components?.concentration.basis ?? null])
  );
  const totals = computeTotals(holdings, scoredBasis);
  const standouts = computeStandouts(holdings);
  const exposure = computeExposure(holdings, totals);
  const verdict_counts = computeVerdictCounts(holdings);

  const not_measured: NotMeasuredEntry[] = holdings
    .filter((h) => h.unavailable_blocks.length > 0)
    .map((h) => ({ symbol: h.symbol, blocks: h.unavailable_blocks }));

  const provenance = packages.flatMap((p) => p.provenance);
  const steps = packages.flatMap((p) => p.steps);
  const credits_used = packages.reduce((sum, p) => sum + p.credits_used, 0);

  const as_of = packages.map((p) => p.trade_date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

  return {
    as_of,
    window_sessions: windowSessions,
    holdings,
    totals,
    standouts,
    exposure,
    verdict_counts,
    not_measured,
    provenance,
    steps,
    credits_used,
    duration_ms: durationMs,
  };
}

/**
 * Emits a leaf path for every field the model is allowed to cite from a
 * PortfolioPackage. Same discipline as `allowedGroundedPaths`: an UNAVAILABLE
 * Measure contributes nothing, so "not measured" can never be narrated as a
 * portfolio-wide zero.
 */
export function allowedPortfolioPaths(pkg: PortfolioPackage): Set<string> {
  const paths = new Set<string>();

  paths.add("as_of");
  if (pkg.window_sessions !== null) paths.add("window_sessions");

  for (const [name, value] of Object.entries(pkg.totals)) {
    if (isMeasure(value) && value.value_status === "AVAILABLE") paths.add(`totals.${name}`);
  }

  paths.add("verdict_counts");

  if (pkg.standouts.concentration.length > 0) paths.add("standouts.concentration");
  if (pkg.standouts.breadth.length > 0) paths.add("standouts.breadth");
  if (pkg.standouts.persistence.length > 0) paths.add("standouts.persistence");

  if (pkg.exposure.by_subsector.length > 0) paths.add("exposure.by_subsector");
  if (pkg.exposure.largest_position && pkg.exposure.largest_position.weight_pct.value_status === "AVAILABLE") {
    paths.add("exposure.largest_position");
  }
  if (pkg.exposure.unvalued_cost_share.value_status === "AVAILABLE") paths.add("exposure.unvalued_cost_share");

  if (pkg.not_measured.length > 0) paths.add("not_measured");

  for (const h of pkg.holdings) {
    const prefix = `holdings.${h.symbol}`;
    for (const [group, fields] of Object.entries({
      position: h.position,
      flow: h.flow,
      valuation: h.valuation,
      peers: h.peers,
    }) as [string, Record<string, unknown>][]) {
      for (const [field, value] of Object.entries(fields)) {
        if (isMeasure(value) && value.value_status === "AVAILABLE") paths.add(`${prefix}.${group}.${field}`);
      }
    }
    if (h.company_name || h.sub_sector) paths.add(`${prefix}.identity`);
    if (h.context_counts.news + h.context_counts.filings + h.context_counts.corporate_actions > 0) {
      paths.add(`${prefix}.context_counts`);
    }
  }

  return paths;
}
