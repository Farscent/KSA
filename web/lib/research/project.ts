/**
 * Raw Sectors payload -> slim typed block.
 *
 * Two jobs, both load-bearing:
 *
 * 1. **Shrink.** A single `sections=peers` response is ~8k tokens of nested
 *    revenue and expense breakdowns. The package the LLM sees must carry the
 *    ratio table and nothing else, or the prompt drowns in data nobody cites.
 * 2. **Type honestly.** A section the provider omitted becomes UNAVAILABLE
 *    with a reason code, never an object of nulls that reads as zero.
 *
 * Every projector is a pure function of an already-fetched payload, so
 * tests/fixtures under web/fixtures/research/ exercise them at zero credits.
 */

import {
  available,
  unavailable,
  type ResearchBlock,
  type ContextItem,
  type CorporateActionItem,
  type Dividend,
  type Financials,
  type Future,
  type Identity,
  type MacroContext,
  type MacroItem,
  type NearbyContext,
  type PeerCompany,
  type Peers,
  type Subsector,
  type Valuation,
} from "@/lib/research/types";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** "Food & Beverage" -> "food-beverage", matching the subsector slug format. */
export function subsectorSlug(name: string | null): string | null {
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

export function projectIdentity(payload: unknown): ResearchBlock<Identity> {
  const root = obj(payload);
  const overview = obj(root?.overview);
  if (!overview) return unavailable<Identity>("NO_OVERVIEW_SECTION");
  const subSector = str(overview.sub_sector);
  return available<Identity>(
    {
      company_name: str(root?.company_name),
      sector: str(overview.sector),
      sub_sector: subSector,
      sub_sector_slug: subsectorSlug(subSector),
      industry: str(overview.industry),
      listing_board: str(overview.listing_board),
      listing_date: str(overview.listing_date),
      employee_num: num(overview.employee_num),
      market_cap: num(overview.market_cap),
      market_cap_rank: num(overview.market_cap_rank),
      last_close_price: num(overview.last_close_price),
      latest_close_date: str(overview.latest_close_date),
    },
    str(overview.latest_close_date)
  );
}

export function projectValuation(payload: unknown): ResearchBlock<Valuation> {
  const valuation = obj(obj(payload)?.valuation);
  if (!valuation) return unavailable<Valuation>("NO_VALUATION_SECTION");
  const historical = arr(valuation.historical_valuation)
    .map(obj)
    .filter((row): row is Json => row !== null)
    .map((row) => ({
      year: num(row.year) ?? 0,
      pb: num(row.pb),
      pe: num(row.pe),
      ps: num(row.ps),
      pb_peer_avg: num(row.pb_peer_avg),
      pe_peer_avg: num(row.pe_peer_avg),
      ps_peer_avg: num(row.ps_peer_avg),
    }))
    .filter((row) => row.year > 0)
    .sort((a, b) => a.year - b.year);

  return available<Valuation>(
    {
      last_close_price: num(valuation.last_close_price),
      latest_close_date: str(valuation.latest_close_date),
      forward_pe: num(valuation.forward_pe),
      intrinsic_value: num(valuation.intrinsic_value),
      historical_valuation: historical,
    },
    str(valuation.latest_close_date)
  );
}

export function projectFinancials(payload: unknown): ResearchBlock<Financials> {
  const financials = obj(obj(payload)?.financials);
  if (!financials) return unavailable<Financials>("NO_FINANCIALS_SECTION");

  const historicalEps = Object.entries(obj(financials.historical_eps) ?? {})
    .map(([year, value]) => {
      const row = obj(value);
      return { year: Number(year), eps: num(row?.eps), eps_growth: num(row?.eps_growth) };
    })
    .filter((row) => Number.isFinite(row.year))
    .sort((a, b) => a.year - b.year);

  const historicalFinancials = arr(financials.historical_financials)
    .map(obj)
    .filter((row): row is Json => row !== null)
    .map((row) => ({
      year: num(row.year) ?? 0,
      revenue: num(row.revenue),
      earnings: num(row.earnings),
      operating_cash_flow: num(row.operating_cash_flow),
      free_cash_flow: num(row.free_cash_flow),
      total_debt: num(row.total_debt),
      net_debt: num(row.net_debt),
      cash_and_equivalents: num(row.cash_and_equivalents),
      ebit: num(row.ebit),
      ebitda: num(row.ebitda),
      interest_expense: num(row.interest_expense),
      total_equity: num(row.total_equity),
      total_assets: num(row.total_assets),
    }))
    .filter((row) => row.year > 0)
    .sort((a, b) => a.year - b.year);

  // Ratios are published per year; take the most recent one and say which.
  const ratios = arr(financials.historical_financial_ratio)
    .map(obj)
    .filter((row): row is Json => row !== null)
    .sort((a, b) => String(a.year).localeCompare(String(b.year)));
  const latestRatio = ratios[ratios.length - 1];
  const profitability = obj(latestRatio?.profitability);
  const capital = obj(latestRatio?.capital);
  const liquidity = obj(latestRatio?.liquidity);
  const bankRatios = {
    capital_adequacy_ratio: num(capital?.capital_adequacy_ratio),
    loan_to_deposit_ratio: num(liquidity?.loan_to_deposit_ratio),
    casa_ratio: num(liquidity?.casa_ratio),
    net_interest_margin: num(profitability?.net_interest_margin),
  };
  const hasBankRatios = Object.values(bankRatios).some((v) => v !== null);

  return available<Financials>({
    eps: num(financials.eps),
    historical_eps: historicalEps,
    historical_financials: historicalFinancials,
    roe: num(profitability?.roe),
    roa: num(profitability?.roa),
    net_profit_margin: num(profitability?.net_profit_margin),
    ratio_year: latestRatio ? String(latestRatio.year) : null,
    bank_ratios: hasBankRatios ? bankRatios : null,
    yoy_quarter_earnings_growth: num(financials.yoy_quarter_earnings_growth),
    yoy_quarter_revenue_growth: num(financials.yoy_quarter_revenue_growth),
  });
}

export function projectFuture(payload: unknown): ResearchBlock<Future> {
  const future = obj(obj(payload)?.future);
  if (!future) return unavailable<Future>("NO_FUTURE_SECTION");
  const rating = obj(future.analyst_rating_breakdown);

  return available<Future>(
    {
      value_forecasts: arr(future.company_value_forecasts)
        .map(obj)
        .filter((row): row is Json => row !== null)
        .map((row) => ({
          estimate_year: num(row.estimate_year) ?? 0,
          eps_estimate: num(row.eps_estimate),
          revenue_estimate: num(row.revenue_estimate),
        })),
      growth_forecasts: arr(future.company_growth_forecasts)
        .map(obj)
        .filter((row): row is Json => row !== null)
        .map((row) => ({
          estimate_year: num(row.estimate_year) ?? 0,
          base_year: num(row.base_year) ?? 0,
          eps_growth: num(row.eps_growth),
          revenue_growth: num(row.revenue_growth),
        })),
      analyst_rating_breakdown: rating
        ? {
            strong_buy: num(rating.strong_buy),
            buy: num(rating.buy),
            hold: num(rating.hold),
            sell: num(rating.sell),
            strong_sell: num(rating.strong_sell),
            n_analyst: num(rating.n_analyst),
            updated_on: str(rating.updated_on),
          }
        : null,
    },
    str(rating?.updated_on)
  );
}

export function projectDividend(payload: unknown): ResearchBlock<Dividend> {
  const dividend = obj(obj(payload)?.dividend);
  if (!dividend) return unavailable<Dividend>("NO_DIVIDEND_SECTION");
  const avg = obj(dividend.dividend_yield_avg);
  return available<Dividend>(
    {
      yield_ttm: num(dividend.yield_ttm),
      dividend_ttm: num(dividend.dividend_ttm),
      payout_ratio: num(dividend.payout_ratio),
      last_ex_dividend_date: str(dividend.last_ex_dividend_date),
      avg_yield: num(avg?.avg_yield),
      avg_yield_period: num(avg?.period),
    },
    str(dividend.last_ex_dividend_date)
  );
}

export function projectPeers(payload: unknown): ResearchBlock<Peers> {
  // `peers` is an array holding one object with a `peers_data` key.
  const peersData = obj(arr(obj(payload)?.peers)[0])?.peers_data;
  const data = obj(peersData);
  if (!data) return unavailable<Peers>("NO_PEERS_SECTION");

  const companies: PeerCompany[] = arr(data.companies)
    .map(obj)
    .filter((row): row is Json => row !== null)
    .map((row) => ({
      // Peer symbols arrive suffixed (BBCA.JK); strip it so they join against
      // our own bare-symbol universe.
      symbol: (str(row.symbol) ?? "").replace(/\.JK$/i, ""),
      company_name: str(row.company_name),
      is_self: arr(row.group).includes("self"),
      pb_mrq: num(row.pb_mrq),
      pe_ttm: num(row.pe_ttm),
      market_cap: num(row.market_cap),
      net_income: num(row.net_income),
      total_revenue: num(row.total_revenue),
      total_equity: num(row.total_equity),
      total_assets: num(row.total_assets),
      employee_num: num(row.employee_num),
      yearly_mcap_chg: num(row.yearly_mcap_chg),
    }))
    .filter((row) => row.symbol);

  if (companies.length === 0) return unavailable<Peers>("NO_PEER_COMPANIES");
  return available<Peers>({ sub_sector: str(obj(data.group_name)?.sub_sector), companies });
}

export function projectSubsector(payload: unknown): ResearchBlock<Subsector> {
  const root = obj(payload);
  if (!root) return unavailable<Subsector>("NO_SUBSECTOR_REPORT");
  const statistics = obj(root.statistics);
  const historical = obj(obj(root.valuation)?.historical_valuation);
  const forecasts = obj(obj(root.growth)?.growth_forecasts);

  const years = Object.keys(historical ?? {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const latestYear = years[years.length - 1] ?? null;
  const latest = latestYear === null ? null : obj(historical?.[String(latestYear)]);

  if (!statistics && !latest) return unavailable<Subsector>("NO_SUBSECTOR_SECTIONS");

  return available<Subsector>({
    sub_sector: str(root.sub_sector),
    total_companies: num(statistics?.total_companies),
    median_pe: num(statistics?.filtered_median_pe),
    weighted_avg_pe: num(statistics?.filtered_weighted_avg_pe),
    latest_year: latestYear,
    latest_pb: num(latest?.pb),
    latest_pe: num(latest?.pe),
    latest_ps: num(latest?.ps),
    growth_forecasts: Object.entries(forecasts ?? {})
      .map(([year, value]) => {
        const row = obj(value);
        return {
          estimate_year: Number(year),
          eps_growth: num(row?.eps_growth),
          revenue_growth: num(row?.revenue_growth),
        };
      })
      .filter((row) => Number.isFinite(row.estimate_year))
      .sort((a, b) => a.estimate_year - b.estimate_year),
  });
}

function projectItems(payload: unknown, symbolKey: "symbols" | "symbol"): ContextItem[] {
  return arr(obj(payload)?.results)
    .map(obj)
    .filter((row): row is Json => row !== null)
    .map((row) => {
      const tagged = symbolKey === "symbols" ? arr(row.symbols).length : str(row.symbol) ? 1 : 0;
      return {
        title: str(row.title) ?? "(untitled)",
        timestamp: str(row.timestamp),
        source_url: str(row.source),
        symbols_mentioned: tagged,
      };
    });
}

/**
 * News, filings and corporate actions — shown as nearby context and used to
 * suppress false alarms. Never a cause: AGENTS.md rule 3.
 */
export function projectNearbyContext(
  newsPayload: unknown,
  filingsPayload: unknown,
  corporateActionsPayload: unknown
): ResearchBlock<NearbyContext> {
  const news = projectItems(newsPayload, "symbols");
  const filings = projectItems(filingsPayload, "symbol");

  const actions = obj(obj(corporateActionsPayload)?.corporate_actions);
  const corporate_actions: CorporateActionItem[] = [];
  for (const row of arr(actions?.dividend).map(obj)) {
    if (!row) continue;
    corporate_actions.push({
      kind: "dividend",
      date: str(row.ex_date),
      detail: `Dividend ${num(row.dividend_amount) ?? "?"} per share, paid ${str(row.payment_date) ?? "unknown"}`,
    });
  }
  for (const row of arr(actions?.stock_split).map(obj)) {
    if (!row) continue;
    corporate_actions.push({ kind: "stock_split", date: str(row.date), detail: `Stock split ratio ${num(row.split_ratio) ?? "?"}` });
  }
  for (const row of arr(actions?.right_issue).map(obj)) {
    if (!row) continue;
    corporate_actions.push({ kind: "right_issue", date: str(row.ex_date), detail: `Rights issue priced at ${num(row.price) ?? "?"}` });
  }

  // Newest first, and only actions that carry a date — an undated corporate
  // action cannot be placed "near" an alert window, so it is not context.
  corporate_actions.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  if (news.length === 0 && filings.length === 0 && corporate_actions.length === 0) {
    return unavailable<NearbyContext>("NO_NEARBY_CONTEXT");
  }
  return available<NearbyContext>({
    news,
    filings,
    corporate_actions: corporate_actions.filter((row) => row.date).slice(0, 8),
  });
}

const MACRO_PER_TOPIC = 3;
/** Tavily's relevance score, 0-1. Below this a hit is off-topic ("Prabowo closes
 * state enterprises" under inflation scored 0.16). A hit with no score is kept. */
export const MACRO_MIN_SCORE = 0.3;

/** Hostname without a leading "www.", or null when the URL is not http(s). */
function publisherOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A provider date as YYYY-MM-DD (UTC), or null. Accepts ISO strings and the
 * RFC 1123 form Tavily actually returns ("Tue, 22 Sep 2026 23:55:10 GMT").
 */
function isoDay(value: string | null): string | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const time = iso ? new Date(`${iso}T00:00:00Z`).getTime() : new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Macro and policy headlines for one review window.
 *
 * Keeps title, publisher, date and URL, and nothing else: the provider's
 * snippet is dropped here so no sentence of it can reach the report. An item
 * with no http(s) URL or no date inside the window is discarded — a headline
 * without a source, or from after the data being reviewed, is not evidence.
 */
export function projectMacro(
  resultsByTopic: { topic: string; payload: unknown }[],
  window: { start: string; end: string }
): ResearchBlock<MacroContext> {
  const seen = new Set<string>();
  const items: MacroItem[] = [];

  for (const { topic, payload } of resultsByTopic) {
    const kept = arr(obj(payload)?.results)
      .map(obj)
      .filter((row): row is Json => row !== null)
      .flatMap((row): MacroItem[] => {
        const url = str(row.url);
        const title = str(row.title);
        const published = isoDay(str(row.published_date));
        const publisher = url ? publisherOf(url) : null;
        const score = num(row.score);
        if (score !== null && score < MACRO_MIN_SCORE) return [];
        if (!url || !title || !published || !publisher) return [];
        if (published < window.start || published > window.end) return [];
        return [{ topic, title: title.trim(), publisher, published_date: published, source_url: url }];
      })
      .sort((a, b) => b.published_date.localeCompare(a.published_date))
      .filter((item) => {
        if (seen.has(item.source_url)) return false;
        seen.add(item.source_url);
        return true;
      })
      .slice(0, MACRO_PER_TOPIC);
    items.push(...kept);
  }

  if (items.length === 0) return unavailable<MacroContext>("NO_MACRO_RESULTS");
  items.sort((a, b) => b.published_date.localeCompare(a.published_date));
  return available<MacroContext>({ window_start: window.start, window_end: window.end, items }, window.end);
}
