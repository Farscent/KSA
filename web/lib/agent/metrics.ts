/**
 * Every derived number in the report is computed here, in TypeScript.
 *
 * This file is where CLAUDE.md's "the LLM never does math" rule is actually
 * enforced. The model receives finished figures and writes sentences about
 * them; it is never asked for a ratio, a delta, a median or a percentage.
 *
 * Each measure returns a `Measure`, not a bare number, so "we could not
 * compute this" can never be rendered as "this is zero".
 */

import { SHARES_PER_LOT } from "@/lib/holdings/units";
import type { ResearchBlock, PeerCompany, Peers, Subsector, Valuation } from "@/lib/research/types";

export interface Measure<T = number> {
  value: T | null;
  value_status: "AVAILABLE" | "UNAVAILABLE";
  reason_codes: string[];
}

export function measured<T>(value: T): Measure<T> {
  return { value, value_status: "AVAILABLE", reason_codes: [] };
}

export function notMeasured<T>(...reason_codes: string[]): Measure<T> {
  return { value: null, value_status: "UNAVAILABLE", reason_codes };
}

// -- Position ---------------------------------------------------------------

export interface PositionMetrics {
  lots: Measure;
  shares: Measure;
  average_price: Measure;
  cost_basis: Measure;
  last_close: Measure;
  market_value: Measure;
  unrealised_pl: Measure;
  unrealised_pl_pct: Measure;
  portfolio_weight_pct: Measure;
}

/**
 * Mirrors `lib/portfolio.ts`'s own cost/market/P&L arithmetic — same
 * SHARES_PER_LOT, same "unavailable close means unavailable value" rule — but
 * emits Measures so the narration layer can see which figures are missing.
 */
export function positionMetrics(
  holding: { lots: number; avg: number } | null,
  close: number | null,
  portfolioMarketValue: number | null
): PositionMetrics {
  if (!holding) {
    const none = notMeasured<number>("NOT_HELD");
    return {
      lots: none, shares: none, average_price: none, cost_basis: none,
      last_close: close === null ? notMeasured<number>("NO_CLOSE") : measured(close),
      market_value: none, unrealised_pl: none, unrealised_pl_pct: none, portfolio_weight_pct: none,
    };
  }

  const shares = holding.lots * SHARES_PER_LOT;
  const cost = shares * holding.avg;
  const marketValue = close === null ? null : shares * close;
  const pl = marketValue === null ? null : marketValue - cost;

  return {
    lots: measured(holding.lots),
    shares: measured(shares),
    average_price: measured(holding.avg),
    cost_basis: measured(cost),
    last_close: close === null ? notMeasured<number>("NO_CLOSE") : measured(close),
    market_value: marketValue === null ? notMeasured<number>("NO_CLOSE") : measured(marketValue),
    unrealised_pl: pl === null ? notMeasured<number>("NO_CLOSE") : measured(pl),
    unrealised_pl_pct:
      pl === null ? notMeasured<number>("NO_CLOSE") : cost > 0 ? measured(pl / cost) : notMeasured<number>("ZERO_COST_BASIS"),
    portfolio_weight_pct:
      marketValue === null || portfolioMarketValue === null || portfolioMarketValue <= 0
        ? notMeasured<number>("PORTFOLIO_VALUE_UNAVAILABLE")
        : measured(marketValue / portfolioMarketValue),
  };
}

// -- Peers ------------------------------------------------------------------

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Share of peers this value sits at or below, 0..1. */
export function percentileRank(value: number, population: number[]): number | null {
  const valid = population.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.filter((v) => v <= value).length / valid.length;
}

export interface PeerExclusion {
  symbol: string;
  reason: string;
}

export interface PeerMetrics {
  screened: Measure;
  eligible: Measure;
  excluded: PeerExclusion[];
  self: PeerCompany | null;
  peer_median_pe: Measure;
  peer_median_pb: Measure;
  self_pe_percentile: Measure;
  self_pb_percentile: Measure;
  /** Held symbol's P/E minus the eligible-peer median. */
  pe_vs_peer_median: Measure;
  pb_vs_peer_median: Measure;
  /** Sectors' own subsector median, reported alongside the peer-set median so
   * the two are never conflated. */
  subsector_median_pe: Measure;
}

/**
 * Screens the peer set and compares the held symbol against it.
 *
 * AGENTS.md requires the honest "no suitable alternative found" path: a peer
 * missing the ratios we compare on is *excluded with a reason*, not silently
 * dropped and not scored as zero. If nothing survives, every comparison comes
 * back UNAVAILABLE rather than a best-of-a-bad-set.
 */
export function peerMetrics(peers: ResearchBlock<Peers>, subsector: ResearchBlock<Subsector>): PeerMetrics {
  const subsectorMedianPe =
    subsector.value_status === "AVAILABLE" && subsector.data?.median_pe !== null && subsector.data
      ? measured(subsector.data.median_pe as number)
      : notMeasured<number>("NO_SUBSECTOR_STATISTICS");

  if (peers.value_status !== "AVAILABLE" || !peers.data) {
    const none = notMeasured<number>("NO_PEER_DATA");
    return {
      screened: none, eligible: none, excluded: [], self: null,
      peer_median_pe: none, peer_median_pb: none,
      self_pe_percentile: none, self_pb_percentile: none,
      pe_vs_peer_median: none, pb_vs_peer_median: none,
      subsector_median_pe: subsectorMedianPe,
    };
  }

  const companies = peers.data.companies;
  const self = companies.find((c) => c.is_self) ?? null;
  const candidates = companies.filter((c) => !c.is_self);

  const excluded: PeerExclusion[] = [];
  const eligible: PeerCompany[] = [];
  for (const peer of candidates) {
    const missing: string[] = [];
    if (peer.pe_ttm === null) missing.push("P/E");
    if (peer.pb_mrq === null) missing.push("P/B");
    if (peer.market_cap === null) missing.push("market cap");
    if (missing.length > 0) {
      excluded.push({ symbol: peer.symbol, reason: `missing ${missing.join(", ")}` });
      continue;
    }
    // A negative P/E means the company lost money; it cannot be compared on an
    // earnings multiple, so exclude it and say why rather than dragging the
    // median somewhere meaningless.
    if (peer.pe_ttm !== null && peer.pe_ttm <= 0) {
      excluded.push({ symbol: peer.symbol, reason: "non-positive P/E (loss-making)" });
      continue;
    }
    eligible.push(peer);
  }

  if (eligible.length === 0) {
    const none = notMeasured<number>("NO_ELIGIBLE_PEERS");
    return {
      screened: measured(candidates.length), eligible: measured(0), excluded, self,
      peer_median_pe: none, peer_median_pb: none,
      self_pe_percentile: none, self_pb_percentile: none,
      pe_vs_peer_median: none, pb_vs_peer_median: none,
      subsector_median_pe: subsectorMedianPe,
    };
  }

  const pes = eligible.map((p) => p.pe_ttm as number);
  const pbs = eligible.map((p) => p.pb_mrq as number);
  const medianPe = median(pes);
  const medianPb = median(pbs);

  const selfPe = self?.pe_ttm ?? null;
  const selfPb = self?.pb_mrq ?? null;

  return {
    screened: measured(candidates.length),
    eligible: measured(eligible.length),
    excluded,
    self,
    peer_median_pe: medianPe === null ? notMeasured<number>("NO_ELIGIBLE_PEERS") : measured(medianPe),
    peer_median_pb: medianPb === null ? notMeasured<number>("NO_ELIGIBLE_PEERS") : measured(medianPb),
    self_pe_percentile:
      selfPe === null ? notMeasured<number>("NO_SELF_PE") : (() => {
        const rank = percentileRank(selfPe, pes);
        return rank === null ? notMeasured<number>("NO_ELIGIBLE_PEERS") : measured(rank);
      })(),
    self_pb_percentile:
      selfPb === null ? notMeasured<number>("NO_SELF_PB") : (() => {
        const rank = percentileRank(selfPb, pbs);
        return rank === null ? notMeasured<number>("NO_ELIGIBLE_PEERS") : measured(rank);
      })(),
    pe_vs_peer_median:
      selfPe === null || medianPe === null ? notMeasured<number>("NO_SELF_PE") : measured(selfPe - medianPe),
    pb_vs_peer_median:
      selfPb === null || medianPb === null ? notMeasured<number>("NO_SELF_PB") : measured(selfPb - medianPb),
    subsector_median_pe: subsectorMedianPe,
  };
}

// -- Valuation --------------------------------------------------------------

export interface ValuationMetrics {
  last_close: Measure;
  forward_pe: Measure;
  /** Sectors' published intrinsic value. Reported, never our own estimate. */
  sectors_intrinsic_value: Measure;
  /**
   * `last_close - intrinsic_value`, as a fraction of intrinsic value. This is
   * arithmetic on two figures Sectors publishes, not a valuation of our own:
   * the report must attribute it, and must not turn it into a target price.
   */
  close_vs_intrinsic_pct: Measure;
  latest_pe: Measure;
  latest_pe_peer_avg: Measure;
  latest_valuation_year: Measure;
}

export function valuationMetrics(valuation: ResearchBlock<Valuation>): ValuationMetrics {
  if (valuation.value_status !== "AVAILABLE" || !valuation.data) {
    const none = notMeasured<number>("NO_VALUATION_DATA");
    return {
      last_close: none, forward_pe: none, sectors_intrinsic_value: none,
      close_vs_intrinsic_pct: none, latest_pe: none, latest_pe_peer_avg: none,
      latest_valuation_year: none,
    };
  }

  const { last_close_price, forward_pe, intrinsic_value, historical_valuation } = valuation.data;
  const latest = historical_valuation[historical_valuation.length - 1] ?? null;

  return {
    last_close: last_close_price === null ? notMeasured<number>("NO_CLOSE") : measured(last_close_price),
    forward_pe: forward_pe === null ? notMeasured<number>("NO_FORWARD_PE") : measured(forward_pe),
    sectors_intrinsic_value:
      intrinsic_value === null ? notMeasured<number>("NO_INTRINSIC_VALUE") : measured(intrinsic_value),
    close_vs_intrinsic_pct:
      last_close_price === null || intrinsic_value === null || intrinsic_value === 0
        ? notMeasured<number>("NO_INTRINSIC_VALUE")
        : measured((last_close_price - intrinsic_value) / intrinsic_value),
    latest_pe: latest?.pe == null ? notMeasured<number>("NO_HISTORICAL_PE") : measured(latest.pe),
    latest_pe_peer_avg:
      latest?.pe_peer_avg == null ? notMeasured<number>("NO_PEER_AVG_PE") : measured(latest.pe_peer_avg),
    latest_valuation_year: latest?.year == null ? notMeasured<number>("NO_HISTORICAL_PE") : measured(latest.year),
  };
}
