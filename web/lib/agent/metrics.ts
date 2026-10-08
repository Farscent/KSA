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
import type { Financials, Identity, ResearchBlock, PeerCompany, Peers, Subsector, Valuation } from "@/lib/research/types";

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
  /** Absent on runs saved before the Peers tab read this. */
  code?: "MISSING_RATIO" | "NON_POSITIVE_PE";
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
      excluded.push({ symbol: peer.symbol, reason: `missing ${missing.join(", ")}`, code: "MISSING_RATIO" });
      continue;
    }
    // A negative P/E means the company lost money; it cannot be compared on an
    // earnings multiple, so exclude it and say why rather than dragging the
    // median somewhere meaningless.
    if (peer.pe_ttm !== null && peer.pe_ttm <= 0) {
      excluded.push({ symbol: peer.symbol, reason: "non-positive P/E (loss-making)", code: "NON_POSITIVE_PE" });
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

// -- Earnings quality and balance sheet --------------------------------------

export interface QualityMetrics {
  is_bank: boolean;
  /** The latest financial year the figures below describe. */
  year: Measure;
  /** Free cash flow over net income, cumulative across the last three years. */
  fcf_to_net_income_3y: Measure;
  fcf_margin: Measure;
  revenue_growth_yoy: Measure;
  earnings_growth_yoy: Measure;
  net_debt: Measure;
  net_debt_to_ebitda: Measure;
  interest_coverage: Measure;
  debt_to_equity: Measure;
  /** Bank ratios, as published by Sectors. UNAVAILABLE for non-banks. */
  capital_adequacy_ratio: Measure;
  loan_to_deposit_ratio: Measure;
  casa_ratio: Measure;
  net_interest_margin: Measure;
}

function growth(current: number | null, prior: number | null): Measure {
  if (current === null || prior === null) return notMeasured("NO_PRIOR_YEAR");
  if (prior === 0) return notMeasured("ZERO_PRIOR_YEAR");
  // Absolute value of the prior year, so a swing from loss to profit reads as
  // growth rather than flipping sign (Equity-Research-Company's convention).
  return measured((current - prior) / Math.abs(prior));
}

/**
 * Cash-flow, leverage and growth measures from the annual series Sectors
 * already returned for `sections=financials` — no extra fetch, no extra
 * credits.
 *
 * Banks fund themselves with customer deposits, so free cash flow against
 * profit, net debt against EBITDA and interest cover are not meaningful for
 * them. Those measures come back UNAVAILABLE with NOT_APPLICABLE_BANK rather
 * than as a number that would read as a finding; the bank ratios Sectors
 * publishes (capital adequacy, loan-to-deposit, CASA, net interest margin)
 * are reported instead.
 */
export function qualityMetrics(financials: ResearchBlock<Financials>, identity: ResearchBlock<Identity>): QualityMetrics {
  const fin = financials.value_status === "AVAILABLE" ? financials.data : null;
  const years = (fin?.historical_financials ?? []).filter((y) => y.year > 0);
  const latest = years[years.length - 1] ?? null;
  const prior = years[years.length - 2] ?? null;
  const bank = fin?.bank_ratios ?? null;
  const isBank = identity.data?.sub_sector === "Banks" || bank?.capital_adequacy_ratio != null;

  if (!fin || !latest) {
    const none = notMeasured<number>("NO_FINANCIALS_SECTION");
    return {
      is_bank: isBank, year: none, fcf_to_net_income_3y: none, fcf_margin: none, revenue_growth_yoy: none,
      earnings_growth_yoy: none, net_debt: none, net_debt_to_ebitda: none, interest_coverage: none,
      debt_to_equity: none, capital_adequacy_ratio: none, loan_to_deposit_ratio: none, casa_ratio: none,
      net_interest_margin: none,
    };
  }

  const bankOnly = (v: number | null | undefined): Measure =>
    !isBank ? notMeasured<number>("NOT_A_BANK") : v == null ? notMeasured<number>("NO_BANK_RATIO") : measured(v);
  const nonBank = (compute: () => Measure): Measure =>
    isBank ? notMeasured<number>("NOT_APPLICABLE_BANK") : compute();

  const lastThree = years.slice(-3);
  const fcfToNetIncome = (): Measure => {
    if (lastThree.length < 3) return notMeasured("NEEDS_THREE_YEARS");
    if (lastThree.some((y) => y.free_cash_flow === null || y.earnings === null)) return notMeasured("MISSING_CASH_FLOW");
    const fcf = lastThree.reduce((sum, y) => sum + (y.free_cash_flow as number), 0);
    const earnings = lastThree.reduce((sum, y) => sum + (y.earnings as number), 0);
    return earnings > 0 ? measured(fcf / earnings) : notMeasured("NON_POSITIVE_EARNINGS");
  };

  return {
    is_bank: isBank,
    year: measured(latest.year),
    fcf_to_net_income_3y: nonBank(fcfToNetIncome),
    fcf_margin: nonBank(() =>
      latest.free_cash_flow === null || latest.revenue === null || latest.revenue <= 0
        ? notMeasured("MISSING_CASH_FLOW")
        : measured(latest.free_cash_flow / latest.revenue)
    ),
    revenue_growth_yoy: prior ? growth(latest.revenue, prior.revenue) : notMeasured("NO_PRIOR_YEAR"),
    earnings_growth_yoy: prior ? growth(latest.earnings, prior.earnings) : notMeasured("NO_PRIOR_YEAR"),
    net_debt: nonBank(() => (latest.net_debt === null ? notMeasured("NO_NET_DEBT") : measured(latest.net_debt))),
    net_debt_to_ebitda: nonBank(() =>
      latest.net_debt === null || latest.ebitda === null
        ? notMeasured("NO_NET_DEBT")
        : latest.ebitda <= 0
          ? notMeasured("NON_POSITIVE_EBITDA")
          : measured(latest.net_debt / latest.ebitda)
    ),
    interest_coverage: nonBank(() =>
      latest.ebit === null || latest.interest_expense === null
        ? notMeasured("NO_INTEREST_EXPENSE")
        : latest.interest_expense <= 0
          ? notMeasured("NO_INTEREST_EXPENSE")
          : measured(latest.ebit / latest.interest_expense)
    ),
    debt_to_equity: nonBank(() =>
      latest.total_debt === null || latest.total_equity === null
        ? notMeasured("NO_DEBT_OR_EQUITY")
        : latest.total_equity <= 0
          ? notMeasured("NON_POSITIVE_EQUITY")
          : measured(latest.total_debt / latest.total_equity)
    ),
    capital_adequacy_ratio: bankOnly(bank?.capital_adequacy_ratio),
    loan_to_deposit_ratio: bankOnly(bank?.loan_to_deposit_ratio),
    casa_ratio: bankOnly(bank?.casa_ratio),
    net_interest_margin: bankOnly(bank?.net_interest_margin),
  };
}
