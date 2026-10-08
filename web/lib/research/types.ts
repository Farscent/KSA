/**
 * Shapes for the research layer.
 *
 * Every block mirrors the `serve_*` contract's discipline: a block is either
 * AVAILABLE with data, or UNAVAILABLE with reason codes and `data: null`.
 * There is no third state where a missing measurement renders as a zero — that
 * is the rule the whole project is built on (see docs/serve-contract-1.1.md).
 */

export type ValueStatus = "AVAILABLE" | "UNAVAILABLE";

export interface ResearchBlock<T> {
  value_status: ValueStatus;
  reason_codes: string[];
  /** The date the underlying figures describe, when the provider states one. */
  as_of: string | null;
  data: T | null;
}

export function available<T>(data: T, as_of: string | null = null): ResearchBlock<T> {
  return { value_status: "AVAILABLE", reason_codes: [], as_of, data };
}

export function unavailable<T>(...reason_codes: string[]): ResearchBlock<T> {
  return { value_status: "UNAVAILABLE", reason_codes, as_of: null, data: null };
}

export interface Identity {
  company_name: string | null;
  sector: string | null;
  sub_sector: string | null;
  /** Kebab-case slug for `subsector/report/`, derived from `sub_sector`. */
  sub_sector_slug: string | null;
  industry: string | null;
  listing_board: string | null;
  listing_date: string | null;
  employee_num: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  last_close_price: number | null;
  latest_close_date: string | null;
}

export interface HistoricalValuationYear {
  year: number;
  pb: number | null;
  pe: number | null;
  ps: number | null;
  pb_peer_avg: number | null;
  pe_peer_avg: number | null;
  ps_peer_avg: number | null;
}

export interface Valuation {
  last_close_price: number | null;
  latest_close_date: string | null;
  forward_pe: number | null;
  /** Sectors' own published figure. We report it; we never compute a target. */
  intrinsic_value: number | null;
  historical_valuation: HistoricalValuationYear[];
}

export interface FinancialYear {
  year: number;
  revenue: number | null;
  earnings: number | null;
  operating_cash_flow: number | null;
  free_cash_flow: number | null;
  total_debt: number | null;
  net_debt: number | null;
  cash_and_equivalents: number | null;
  ebit: number | null;
  ebitda: number | null;
  interest_expense: number | null;
  total_equity: number | null;
  total_assets: number | null;
}

/** Bank-specific ratios Sectors publishes alongside the generic ones. */
export interface BankRatios {
  capital_adequacy_ratio: number | null;
  loan_to_deposit_ratio: number | null;
  casa_ratio: number | null;
  net_interest_margin: number | null;
}

export interface Financials {
  eps: number | null;
  historical_eps: { year: number; eps: number | null; eps_growth: number | null }[];
  historical_financials: FinancialYear[];
  roe: number | null;
  roa: number | null;
  net_profit_margin: number | null;
  ratio_year: string | null;
  /** Null when the issuer is not a bank, or Sectors published none. */
  bank_ratios: BankRatios | null;
  yoy_quarter_earnings_growth: number | null;
  yoy_quarter_revenue_growth: number | null;
}

export interface Future {
  value_forecasts: { estimate_year: number; eps_estimate: number | null; revenue_estimate: number | null }[];
  growth_forecasts: { estimate_year: number; base_year: number; eps_growth: number | null; revenue_growth: number | null }[];
  analyst_rating_breakdown: {
    strong_buy: number | null;
    buy: number | null;
    hold: number | null;
    sell: number | null;
    strong_sell: number | null;
    n_analyst: number | null;
    updated_on: string | null;
  } | null;
}

export interface Dividend {
  yield_ttm: number | null;
  dividend_ttm: number | null;
  payout_ratio: number | null;
  last_ex_dividend_date: string | null;
  avg_yield: number | null;
  avg_yield_period: number | null;
}

export interface PeerCompany {
  symbol: string;
  company_name: string | null;
  is_self: boolean;
  pb_mrq: number | null;
  pe_ttm: number | null;
  market_cap: number | null;
  net_income: number | null;
  total_revenue: number | null;
  total_equity: number | null;
  total_assets: number | null;
  employee_num: number | null;
  yearly_mcap_chg: number | null;
}

export interface Peers {
  sub_sector: string | null;
  companies: PeerCompany[];
}

export interface Subsector {
  sub_sector: string | null;
  total_companies: number | null;
  median_pe: number | null;
  weighted_avg_pe: number | null;
  latest_year: number | null;
  latest_pb: number | null;
  latest_pe: number | null;
  latest_ps: number | null;
  growth_forecasts: { estimate_year: number; eps_growth: number | null; revenue_growth: number | null }[];
}

export interface ContextItem {
  title: string;
  timestamp: string | null;
  source_url: string | null;
  /** How many tickers the item tags. A story tagging ten symbols is weak
   * context for any one of them, and the report should be able to say so. */
  symbols_mentioned: number;
}

export interface CorporateActionItem {
  kind: "dividend" | "stock_split" | "right_issue" | "agm";
  date: string | null;
  detail: string;
}

export interface MacroItem {
  topic: string;
  title: string;
  publisher: string;
  published_date: string;
  source_url: string;
}

/** Headlines only, each with its source URL. No figures are extracted. */
export interface MacroContext {
  window_start: string;
  window_end: string;
  items: MacroItem[];
}

export interface NearbyContext {
  news: ContextItem[];
  filings: ContextItem[];
  corporate_actions: CorporateActionItem[];
}
