/**
 * Every derived cross-holding number, computed in TypeScript — the portfolio
 * synthesis carries the same "LLM never does math" rule Part 2's per-symbol
 * pipeline enforces (see lib/agent/metrics.ts).
 *
 * The one rule specific to this file: concentration, breadth and persistence
 * are compared *within themselves only*. Nothing here ever combines two
 * components, or two holdings' different components, into a single number —
 * that would be exactly the "one severity score" CLAUDE.md forbids, just
 * rebuilt at the portfolio level. `computeStandouts` below returns three
 * independent lists for that reason, and there is no ranking function that
 * takes more than one component as input.
 */

import { measured, notMeasured, type Measure } from "@/lib/agent/metrics";
import type { ResearchPackage } from "@/lib/agent/package";
import type { Verdict } from "@/lib/verdict";

// -- The digest: one holding, projected down to what the summary needs -----

export interface HoldingDigest {
  symbol: string;
  company_name: string | null;
  sub_sector: string | null;
  verdict: Verdict;
  trade_date: string;
  position: {
    lots: Measure;
    cost_basis: Measure;
    market_value: Measure;
    unrealised_pl: Measure;
    unrealised_pl_pct: Measure;
    portfolio_weight_pct: Measure;
  };
  flow: {
    concentration_share: Measure;
    concentration_baseline: Measure;
    breadth_changed: Measure;
    breadth_active: Measure;
    persistence_same_direction: Measure;
    persistence_of_sessions: Measure;
    persistence_longest_run: Measure;
    coverage_matched_share: Measure;
  };
  valuation: {
    last_close: Measure;
    forward_pe: Measure;
    close_vs_intrinsic_pct: Measure;
  };
  peers: {
    eligible: Measure;
    pe_vs_peer_median: Measure;
  };
  context_counts: {
    news: number;
    filings: number;
    corporate_actions: number;
  };
  /** Package blocks that came back UNAVAILABLE for this holding, by name —
   * never silently dropped, always nameable in the "what to watch" section. */
  unavailable_blocks: string[];
}

function componentField<K extends string>(
  block: { value_status: "AVAILABLE" | "UNAVAILABLE"; reason_codes: string[] } | undefined,
  field: K,
  value: number | boolean | null | undefined
): Measure {
  if (!block || block.value_status !== "AVAILABLE") {
    return notMeasured(...(block?.reason_codes.length ? block.reason_codes : ["NOT_MEASURED"]));
  }
  if (value === null || value === undefined) return notMeasured("FIELD_NULL");
  return measured(typeof value === "boolean" ? (value ? 1 : 0) : value);
}

export function digestOf(pkg: ResearchPackage): HoldingDigest {
  const c = pkg.flow.components;
  const unavailable_blocks: string[] = [];

  if (!c) unavailable_blocks.push("flow");
  else {
    if (c.concentration.value_status !== "AVAILABLE") unavailable_blocks.push("flow.concentration");
    if (c.breadth.value_status !== "AVAILABLE") unavailable_blocks.push("flow.breadth");
    if (c.persistence.value_status !== "AVAILABLE") unavailable_blocks.push("flow.persistence");
    if (c.coverage.value_status !== "AVAILABLE") unavailable_blocks.push("flow.coverage");
  }
  if (pkg.identity.value_status !== "AVAILABLE") unavailable_blocks.push("identity");
  if (pkg.valuation.value_status !== "AVAILABLE") unavailable_blocks.push("valuation");
  if (pkg.peers.value_status !== "AVAILABLE") unavailable_blocks.push("peers");
  if (pkg.context.value_status !== "AVAILABLE") unavailable_blocks.push("context");

  return {
    symbol: pkg.symbol,
    company_name: pkg.identity.data?.company_name ?? null,
    sub_sector: pkg.identity.data?.sub_sector ?? null,
    verdict: pkg.verdict,
    trade_date: pkg.trade_date,
    position: {
      lots: pkg.position.lots,
      cost_basis: pkg.position.cost_basis,
      market_value: pkg.position.market_value,
      unrealised_pl: pkg.position.unrealised_pl,
      unrealised_pl_pct: pkg.position.unrealised_pl_pct,
      portfolio_weight_pct: pkg.position.portfolio_weight_pct,
    },
    flow: {
      concentration_share: componentField(c?.concentration, "share", c?.concentration.share),
      concentration_baseline: componentField(c?.concentration, "baseline_share", c?.concentration.baseline_share),
      breadth_changed: componentField(c?.breadth, "changed", c?.breadth.changed),
      breadth_active: componentField(c?.breadth, "active", c?.breadth.active),
      persistence_same_direction: componentField(
        c?.persistence,
        "same_direction",
        c?.persistence.same_direction
      ),
      persistence_of_sessions: componentField(c?.persistence, "of_sessions", c?.persistence.of_sessions),
      persistence_longest_run: componentField(c?.persistence, "longest_run", c?.persistence.longest_run),
      coverage_matched_share: componentField(c?.coverage, "matched_share", c?.coverage.matched_share),
    },
    valuation: {
      last_close: pkg.valuation_metrics.last_close,
      forward_pe: pkg.valuation_metrics.forward_pe,
      close_vs_intrinsic_pct: pkg.valuation_metrics.close_vs_intrinsic_pct,
    },
    peers: {
      eligible: pkg.peer_metrics.eligible,
      pe_vs_peer_median: pkg.peer_metrics.pe_vs_peer_median,
    },
    context_counts: {
      news: pkg.context.data?.news.length ?? 0,
      filings: pkg.context.data?.filings.length ?? 0,
      corporate_actions: pkg.context.data?.corporate_actions.length ?? 0,
    },
    unavailable_blocks,
  };
}

// -- Totals -------------------------------------------------------------

export interface PortfolioTotals {
  holdings_count: Measure;
  cost_basis: Measure;
  market_value: Measure;
  unrealised_pl: Measure;
  unrealised_pl_pct: Measure;
  measured_count: Measure;
  fixture_count: Measure;
  unscored_count: Measure;
}

export function computeTotals(digests: HoldingDigest[], scoredBasis: Map<string, "MEASURED" | "EXAMPLE_VALUE" | null>): PortfolioTotals {
  const costValues = digests.map((d) => d.position.cost_basis).filter((m) => m.value_status === "AVAILABLE");
  const cost = costValues.reduce((sum, m) => sum + (m.value ?? 0), 0);

  const mktMeasures = digests.map((d) => d.position.market_value);
  const allMktAvailable = digests.length > 0 && mktMeasures.every((m) => m.value_status === "AVAILABLE");
  const mkt = allMktAvailable ? mktMeasures.reduce((sum, m) => sum + (m.value ?? 0), 0) : null;
  const pl = mkt !== null ? mkt - cost : null;

  let measuredCount = 0;
  let fixtureCount = 0;
  let unscoredCount = 0;
  for (const d of digests) {
    const basis = scoredBasis.get(d.symbol) ?? null;
    if (basis === "MEASURED") measuredCount++;
    else if (basis === "EXAMPLE_VALUE") fixtureCount++;
    else unscoredCount++;
  }

  return {
    holdings_count: measured(digests.length),
    cost_basis: costValues.length > 0 ? measured(cost) : notMeasured("NO_HOLDINGS"),
    market_value: mkt === null ? notMeasured("INCOMPLETE_CLOSES") : measured(mkt),
    unrealised_pl: pl === null ? notMeasured("INCOMPLETE_CLOSES") : measured(pl),
    unrealised_pl_pct:
      pl === null || cost <= 0 ? notMeasured("INCOMPLETE_CLOSES") : measured(pl / cost),
    measured_count: measured(measuredCount),
    fixture_count: measured(fixtureCount),
    unscored_count: measured(unscoredCount),
  };
}

// -- Standouts: three independent lists, never merged -----------------------

export interface StandoutEntry {
  symbol: string;
  /** Signed distance from this holding's own baseline for this component. */
  value: number;
}

export interface ComponentStandouts {
  /** Holdings furthest above their own top-3 baseline share, descending. */
  concentration: StandoutEntry[];
  /** Holdings with the most brokers changed side as a share of active brokers, descending. */
  breadth: StandoutEntry[];
  /** Holdings whose anomaly pattern held longest, by longest_run, descending. */
  persistence: StandoutEntry[];
  /** Symbol -> which of the three components could not be measured for it. */
  not_measured: Record<string, string[]>;
}

function topStandouts(entries: StandoutEntry[], n = 5): StandoutEntry[] {
  return [...entries].sort((a, b) => b.value - a.value).slice(0, n);
}

export function computeStandouts(digests: HoldingDigest[]): ComponentStandouts {
  const concentration: StandoutEntry[] = [];
  const breadth: StandoutEntry[] = [];
  const persistence: StandoutEntry[] = [];
  const not_measured: Record<string, string[]> = {};

  for (const d of digests) {
    const gaps: string[] = [];

    const share = d.flow.concentration_share;
    const baseline = d.flow.concentration_baseline;
    if (share.value_status === "AVAILABLE" && baseline.value_status === "AVAILABLE") {
      concentration.push({ symbol: d.symbol, value: (share.value ?? 0) - (baseline.value ?? 0) });
    } else {
      gaps.push("concentration");
    }

    const changed = d.flow.breadth_changed;
    const active = d.flow.breadth_active;
    if (changed.value_status === "AVAILABLE" && active.value_status === "AVAILABLE" && (active.value ?? 0) > 0) {
      breadth.push({ symbol: d.symbol, value: (changed.value ?? 0) / (active.value as number) });
    } else {
      gaps.push("breadth");
    }

    const run = d.flow.persistence_longest_run;
    if (run.value_status === "AVAILABLE") {
      persistence.push({ symbol: d.symbol, value: run.value ?? 0 });
    } else {
      gaps.push("persistence");
    }

    if (gaps.length > 0) not_measured[d.symbol] = gaps;
  }

  return {
    concentration: topStandouts(concentration),
    breadth: topStandouts(breadth),
    persistence: topStandouts(persistence),
    not_measured,
  };
}

// -- Exposure -----------------------------------------------------------

export interface SubsectorExposure {
  sub_sector: string;
  weight_pct: Measure;
  symbols: string[];
}

export interface ExposureMetrics {
  by_subsector: SubsectorExposure[];
  largest_position: { symbol: string; weight_pct: Measure } | null;
  /** Share of portfolio cost basis in holdings whose market value could not
   * be computed this run — named "unvalued", never folded into a risk score. */
  unvalued_cost_share: Measure;
}

export function computeExposure(digests: HoldingDigest[], totals: PortfolioTotals): ExposureMetrics {
  const bySubsector = new Map<string, { cost: number; symbols: string[] }>();
  let unvaluedCost = 0;

  for (const d of digests) {
    const label = d.sub_sector ?? "Unclassified";
    const cost = d.position.cost_basis.value_status === "AVAILABLE" ? (d.position.cost_basis.value ?? 0) : 0;
    const entry = bySubsector.get(label) ?? { cost: 0, symbols: [] };
    entry.cost += cost;
    entry.symbols.push(d.symbol);
    bySubsector.set(label, entry);

    if (d.position.market_value.value_status !== "AVAILABLE") unvaluedCost += cost;
  }

  const totalCost = totals.cost_basis.value_status === "AVAILABLE" ? totals.cost_basis.value : null;

  const by_subsector: SubsectorExposure[] = Array.from(bySubsector.entries())
    .map(([sub_sector, { cost, symbols }]) => ({
      sub_sector,
      weight_pct:
        totalCost !== null && totalCost > 0
          ? measured<number>(cost / totalCost)
          : notMeasured<number>("PORTFOLIO_COST_UNAVAILABLE"),
      symbols,
    }))
    .sort((a, b) => (b.weight_pct.value ?? 0) - (a.weight_pct.value ?? 0));

  let largest: { symbol: string; weight_pct: Measure } | null = null;
  for (const d of digests) {
    const w = d.position.portfolio_weight_pct;
    if (w.value_status !== "AVAILABLE" || w.value === null) continue;
    if (!largest || (largest.weight_pct.value ?? 0) < w.value) largest = { symbol: d.symbol, weight_pct: w };
  }

  return {
    by_subsector,
    largest_position: largest,
    unvalued_cost_share:
      totalCost !== null && totalCost > 0 ? measured(unvaluedCost / totalCost) : notMeasured("PORTFOLIO_COST_UNAVAILABLE"),
  };
}

export interface VerdictCounts {
  Healthy: number;
  Watch: number;
  Rebalance: number;
}

export function computeVerdictCounts(digests: HoldingDigest[]): VerdictCounts {
  const counts: VerdictCounts = { Healthy: 0, Watch: 0, Rebalance: 0 };
  for (const d of digests) counts[d.verdict]++;
  return counts;
}
