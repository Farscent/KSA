/**
 * Turns a ResearchPackage into the fact tables the report shows.
 *
 * Everything the reader sees as a figure is formatted HERE, in code — percent,
 * multiples, Rupiah, dates — and compared to its baseline or peer median HERE.
 * The model is handed these finished strings and writes one headline and a few
 * bullets about them; it is never asked to format, convert or subtract. That is
 * what removes the raw floats ("5.41242719491217") and the 100x percent errors
 * the first Run Analyst reports had.
 *
 * Statuses come from fixed vocabularies with fixed, stated tolerances, so a
 * label like "Above baseline" is auditable rather than a model judgement.
 *
 * Pattern borrowed from Equity-Research-Company's `financial_metrics.md`
 * (controlled verdict labels instead of raw deltas) and ticker-dossier's
 * `reporting.py` (code formats every field by type). See
 * docs/third-party-notices.md.
 */

import type { ResearchPackage } from "@/lib/agent/package";
import type { Measure } from "@/lib/agent/metrics";
import { MACRO_TOPICS } from "@/lib/search/topics";
import { count, idr, pct, signedIdr, signedPct } from "@/lib/format";

export type RowTone = "neutral" | "differs" | "gap";

export interface FactRow {
  /** What was measured, in plain language. */
  label: string;
  /** Already formatted. The model copies figures from here verbatim. */
  value: string;
  /** The baseline / peer median / second figure it is set against. */
  compare: string | null;
  /** One label from a fixed vocabulary; null when there is nothing to say. */
  status: string | null;
  /** The date or period the figure describes. */
  period: string | null;
  tone: RowTone;
  /** Source link for the value, when it is a headline. Never sent to the model. */
  href?: string;
  /** Package paths this row was built from; the section's audit trail. */
  paths: string[];
}

// -- Formatting ---------------------------------------------------------

const DECIMAL = (value: number, digits: number) =>
  value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function mult(value: number): string {
  return `${DECIMAL(value, 2)}×`;
}

export function plain(value: number, digits = 2): string {
  return DECIMAL(value, digits).replace(/^-/, "−");
}

/** Rupiah, scaled so a 15-digit revenue reads as "Rp 174,02 trillion". */
export function idrBig(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}Rp ${DECIMAL(abs / 1e12, 2)} trillion`;
  if (abs >= 1e9) return `${sign}Rp ${DECIMAL(abs / 1e9, 2)} billion`;
  if (abs >= 1e6) return `${sign}Rp ${DECIMAL(abs / 1e6, 2)} million`;
  return value < 0 ? `−${idr(abs)}` : idr(value);
}

export function day(date: string | null | undefined): string | null {
  return date ? date.slice(0, 10) : null;
}

function signedPoints(fractionDiff: number): string {
  const sign = fractionDiff >= 0 ? "+" : "−";
  return `${sign}${DECIMAL(Math.abs(fractionDiff) * 100, 1)} pp`;
}

// -- Fixed-tolerance comparisons ---------------------------------------

/** A share is "in line" with its own baseline within one percentage point. */
export const SHARE_TOLERANCE = 0.01;
/** A multiple is "in line" with a median within 5% of that median. */
export const MULTIPLE_TOLERANCE = 0.05;

type Direction = "above" | "in line" | "below";

function compareShare(value: number, baseline: number): { direction: Direction; points: string } {
  const diff = value - baseline;
  const direction: Direction = Math.abs(diff) <= SHARE_TOLERANCE ? "in line" : diff > 0 ? "above" : "below";
  return { direction, points: signedPoints(diff) };
}

function compareMultiple(value: number, median: number): Direction {
  if (median === 0) return "in line";
  const rel = (value - median) / Math.abs(median);
  return Math.abs(rel) <= MULTIPLE_TOLERANCE ? "in line" : rel > 0 ? "above" : "below";
}

/** "Above baseline" / "In line with baseline" / "Below baseline". */
function against(direction: Direction, reference: string): string {
  return direction === "in line" ? `In line with ${reference}` : `${direction === "above" ? "Above" : "Below"} ${reference}`;
}

function ok<T>(measure: Measure<T>): measure is Measure<T> & { value: T } {
  return measure.value_status === "AVAILABLE" && measure.value !== null;
}

// -- Rows per section ---------------------------------------------------

export function positionRows(pkg: ResearchPackage): FactRow[] {
  const rows: FactRow[] = [];
  const p = pkg.position;
  const identity = pkg.identity.data;

  if (identity?.company_name) {
    rows.push({
      label: "Company",
      value: identity.company_name,
      compare: [identity.sector, identity.sub_sector].filter(Boolean).join(" · ") || null,
      status: null,
      period: null,
      tone: "neutral",
      paths: ["identity.company_name", "identity.sector", "identity.sub_sector"],
    });
  }

  if (ok(p.lots) && ok(p.shares)) {
    rows.push({
      label: "Holding",
      value: `${count(p.lots.value)} lots`,
      compare: `${count(p.shares.value)} shares`,
      status: null,
      period: null,
      tone: "neutral",
      paths: ["position.lots", "position.shares"],
    });
  }
  if (ok(p.average_price)) {
    rows.push({
      label: "Average price paid",
      value: idr(p.average_price.value),
      compare: ok(p.last_close) ? `Last close ${idr(p.last_close.value)}` : null,
      status: null,
      period: day(pkg.valuation.data?.latest_close_date) ?? null,
      tone: "neutral",
      paths: ["position.average_price", "position.last_close"],
    });
  }
  if (ok(p.cost_basis)) {
    rows.push({
      label: "Cost basis",
      value: idr(p.cost_basis.value),
      compare: null,
      status: null,
      period: null,
      tone: "neutral",
      paths: ["position.cost_basis"],
    });
  }
  if (ok(p.market_value)) {
    rows.push({
      label: "Market value",
      value: idr(p.market_value.value),
      compare: ok(p.portfolio_weight_pct) ? `${pct(p.portfolio_weight_pct.value, 1)} of your portfolio` : null,
      status: null,
      period: day(pkg.valuation.data?.latest_close_date) ?? null,
      tone: "neutral",
      paths: ["position.market_value", "position.portfolio_weight_pct"],
    });
  }
  if (ok(p.unrealised_pl)) {
    const pl = p.unrealised_pl.value;
    rows.push({
      label: "Unrealised profit / loss",
      value: signedIdr(pl),
      compare: ok(p.unrealised_pl_pct) ? signedPct(p.unrealised_pl_pct.value, 1) : null,
      status: pl > 0 ? "Above cost" : pl < 0 ? "Below cost" : "At cost",
      period: null,
      tone: "neutral",
      paths: ["position.unrealised_pl", "position.unrealised_pl_pct"],
    });
  }
  return rows;
}

export function flowRows(pkg: ResearchPackage): FactRow[] {
  const c = pkg.flow.components;
  if (!c) return [];
  const rows: FactRow[] = [];
  const period = day(c.trade_date);

  const con = c.concentration;
  if (con.value_status === "AVAILABLE" && con.share !== null) {
    const hasBaseline = con.baseline_share !== null;
    const cmp = hasBaseline ? compareShare(con.share, con.baseline_share as number) : null;
    const band = con.band !== null && con.band_count !== null ? `band ${con.band} of ${con.band_count}` : null;
    rows.push({
      label: `Top-${con.top_n ?? 3} brokers' share of selling`,
      value: pct(con.share, 1),
      compare: hasBaseline ? `${pct(con.baseline_share as number, 1)} own baseline` : null,
      status: cmp
        ? `${against(cmp.direction, "baseline")} (${cmp.points})${band ? `, ${band}` : ""}`
        : "No baseline",
      period,
      tone: cmp && cmp.direction !== "in line" ? "differs" : "neutral",
      paths: [
        "serve_components.concentration.share",
        "serve_components.concentration.baseline_share",
        "serve_components.concentration.top_n",
        "serve_components.concentration.band",
        "serve_components.concentration.band_count",
      ],
    });
  }

  const br = c.breadth;
  if (br.value_status === "AVAILABLE" && br.changed !== null && br.active !== null) {
    const share = br.share;
    const hasBaseline = share !== null && br.baseline_share !== null;
    const cmp = hasBaseline ? compareShare(share as number, br.baseline_share as number) : null;
    rows.push({
      label: "Brokers that changed side",
      value: `${count(br.changed)} of ${count(br.active)}${share !== null ? ` (${pct(share, 1)})` : ""}`,
      compare: br.baseline_share !== null ? `${pct(br.baseline_share, 1)} own baseline` : null,
      status: cmp ? `${against(cmp.direction, "baseline")} (${cmp.points})` : "No baseline",
      period,
      tone: cmp && cmp.direction !== "in line" ? "differs" : "neutral",
      paths: [
        "serve_components.breadth.changed",
        "serve_components.breadth.active",
        "serve_components.breadth.share",
        "serve_components.breadth.baseline_share",
      ],
    });
  }

  const pe = c.persistence;
  if (pe.value_status === "AVAILABLE" && pe.same_direction !== null && pe.of_sessions !== null) {
    rows.push({
      label: "Sessions with flow in the same direction",
      value: `${count(pe.same_direction)} of ${count(pe.of_sessions)}`,
      compare: pe.longest_run !== null ? `Longest unbroken run ${count(pe.longest_run)} ${pe.longest_run === 1 ? "session" : "sessions"}` : null,
      status: "No baseline to compare",
      period,
      tone: "neutral",
      paths: [
        "serve_components.persistence.same_direction",
        "serve_components.persistence.of_sessions",
        "serve_components.persistence.longest_run",
      ],
    });
  }

  const cov = c.coverage;
  if (cov.value_status === "AVAILABLE" && cov.matched_share !== null) {
    const completeness =
      cov.completeness === "FULL" ? "Full coverage" : cov.completeness === "PARTIAL" ? "Partial coverage" : "Coverage unknown";
    rows.push({
      label: "Broker data matched",
      value: pct(cov.matched_share, 2),
      compare:
        cov.cohorts_available !== null && cov.cohorts_total !== null
          ? `${count(cov.cohorts_available)} of ${count(cov.cohorts_total)} broker groups available`
          : null,
      status: completeness,
      period,
      tone: cov.completeness === "FULL" ? "neutral" : "gap",
      paths: [
        "serve_components.coverage.matched_share",
        "serve_components.coverage.cohorts_available",
        "serve_components.coverage.cohorts_total",
        "serve_components.coverage.completeness",
      ],
    });
  }
  return rows;
}

function multipleRow(
  label: string,
  own: number | null,
  peerMedian: Measure,
  subsectorMedian: number | null,
  subsectorName: string | null,
  paths: string[]
): FactRow | null {
  if (own === null) return null;
  const parts: string[] = [];
  if (ok(peerMedian)) parts.push(`Peer median ${mult(peerMedian.value)}`);
  if (subsectorMedian !== null) parts.push(`${subsectorName ?? "Subsector"} median ${mult(subsectorMedian)}`);
  const dir = ok(peerMedian) ? compareMultiple(own, peerMedian.value) : null;
  return {
    label,
    value: mult(own),
    compare: parts.length > 0 ? parts.join(" · ") : null,
    status: dir ? against(dir, "peer median") : null,
    period: null,
    tone: dir && dir !== "in line" ? "differs" : "neutral",
    paths,
  };
}

export function fundamentalsRows(pkg: ResearchPackage): FactRow[] {
  const rows: FactRow[] = [];
  const pm = pkg.peer_metrics;
  const f = pkg.financials.data;

  if (ok(pm.screened) && ok(pm.eligible)) {
    const excluded = pm.excluded.slice(0, 3).map((e) => `${e.symbol} (${e.reason})`);
    rows.push({
      label: "Peers compared",
      value: `${count(pm.eligible.value)} of ${count(pm.screened.value)}`,
      compare:
        pm.excluded.length > 0
          ? `Excluded: ${excluded.join("; ")}${pm.excluded.length > 3 ? `; and ${pm.excluded.length - 3} more` : ""}`
          : null,
      status: pm.eligible.value === 0 ? "No peer qualified" : null,
      period: null,
      tone: pm.eligible.value === 0 ? "gap" : "neutral",
      paths: ["peer_metrics.screened", "peer_metrics.eligible", "peer_metrics.excluded"],
    });
  }

  const subName = pkg.subsector.data?.sub_sector ?? null;
  const pe = multipleRow(
    "Price-to-earnings (P/E)",
    pm.self?.pe_ttm ?? null,
    pm.peer_median_pe,
    ok(pm.subsector_median_pe) ? pm.subsector_median_pe.value : null,
    subName,
    ["peers.companies", "peer_metrics.peer_median_pe", "peer_metrics.subsector_median_pe", "subsector.median_pe"]
  );
  if (pe) rows.push(pe);

  const pb = multipleRow("Price-to-book (P/B)", pm.self?.pb_mrq ?? null, pm.peer_median_pb, null, null, [
    "peers.companies",
    "peer_metrics.peer_median_pb",
  ]);
  if (pb) rows.push(pb);

  if (f) {
    const year = f.ratio_year;
    if (f.roe !== null) {
      rows.push({
        label: "Return on equity",
        value: pct(f.roe, 1),
        compare: null,
        status: null,
        period: year,
        tone: "neutral",
        paths: ["financials.roe", "financials.ratio_year"],
      });
    }
    if (f.net_profit_margin !== null) {
      rows.push({
        label: "Net profit margin",
        value: pct(f.net_profit_margin, 1),
        compare: null,
        status: null,
        period: year,
        tone: "neutral",
        paths: ["financials.net_profit_margin", "financials.ratio_year"],
      });
    }
    if (f.eps !== null) {
      rows.push({
        label: "Earnings per share",
        value: idr(f.eps),
        compare: null,
        status: null,
        period: year,
        tone: "neutral",
        paths: ["financials.eps"],
      });
    }
    const growth = (label: string, v: number | null, path: string): FactRow | null =>
      v === null
        ? null
        : {
            label,
            value: signedPct(v, 1),
            compare: null,
            status: v > 0 ? "Growing" : v < 0 ? "Shrinking" : "Flat",
            period: "Latest quarter vs same quarter last year",
            tone: v < 0 ? "differs" : "neutral",
            paths: [path],
          };
    const eg = growth("Earnings growth, latest quarter", f.yoy_quarter_earnings_growth, "financials.yoy_quarter_earnings_growth");
    const rg = growth("Revenue growth, latest quarter", f.yoy_quarter_revenue_growth, "financials.yoy_quarter_revenue_growth");
    if (eg) rows.push(eg);
    if (rg) rows.push(rg);
  }
  return rows;
}

export function valuationRows(pkg: ResearchPackage): FactRow[] {
  const rows: FactRow[] = [];
  const vm = pkg.valuation_metrics;
  const closeDate = day(pkg.valuation.data?.latest_close_date);

  if (ok(vm.last_close)) {
    rows.push({
      label: "Last close",
      value: idr(vm.last_close.value),
      compare: null,
      status: null,
      period: closeDate,
      tone: "neutral",
      paths: ["valuation_metrics.last_close", "valuation.latest_close_date"],
    });
  }
  if (ok(vm.forward_pe)) {
    rows.push({
      label: "Forward P/E (Sectors)",
      value: mult(vm.forward_pe.value),
      compare: ok(vm.latest_pe_peer_avg) ? `Peer average P/E ${mult(vm.latest_pe_peer_avg.value)}` : null,
      status: null,
      period: ok(vm.latest_valuation_year) ? String(vm.latest_valuation_year.value) : null,
      tone: "neutral",
      paths: ["valuation_metrics.forward_pe", "valuation_metrics.latest_pe_peer_avg"],
    });
  }
  if (ok(vm.sectors_intrinsic_value)) {
    const gap = ok(vm.close_vs_intrinsic_pct) ? vm.close_vs_intrinsic_pct.value : null;
    const dir: Direction | null = gap === null ? null : Math.abs(gap) <= MULTIPLE_TOLERANCE ? "in line" : gap > 0 ? "above" : "below";
    rows.push({
      label: "Intrinsic value, as published by Sectors",
      value: idr(vm.sectors_intrinsic_value.value),
      compare: gap !== null ? `Last close is ${pct(Math.abs(gap), 1)} ${gap >= 0 ? "above" : "below"} this figure` : null,
      status: dir ? `Close ${dir === "in line" ? "in line with" : dir} Sectors' figure` : null,
      period: closeDate,
      tone: dir && dir !== "in line" ? "differs" : "neutral",
      paths: ["valuation_metrics.sectors_intrinsic_value", "valuation_metrics.close_vs_intrinsic_pct"],
    });
  }

  const div = pkg.dividend.data;
  if (div && div.yield_ttm !== null) {
    rows.push({
      label: "Dividend yield, trailing 12 months",
      value: pct(div.yield_ttm, 1),
      compare: div.dividend_ttm !== null ? `${idr(div.dividend_ttm)} per share` : null,
      status: null,
      period: div.last_ex_dividend_date ? `Last ex-dividend ${day(div.last_ex_dividend_date)}` : null,
      tone: "neutral",
      paths: ["dividend.yield_ttm", "dividend.dividend_ttm", "dividend.last_ex_dividend_date"],
    });
  }

  const rating = pkg.future.data?.analyst_rating_breakdown;
  if (rating && rating.n_analyst !== null) {
    const bits = [
      ["strong buy", rating.strong_buy],
      ["buy", rating.buy],
      ["hold", rating.hold],
      ["sell", rating.sell],
      ["strong sell", rating.strong_sell],
    ]
      .filter(([, n]) => n !== null)
      .map(([name, n]) => `${count(n as number)} ${name}`);
    rows.push({
      label: "Analyst ratings (published by Sectors)",
      value: bits.join(" · "),
      compare: `${count(rating.n_analyst)} analysts`,
      status: null,
      period: day(rating.updated_on) ? `Updated ${day(rating.updated_on)}` : null,
      tone: "neutral",
      paths: ["future.analyst_rating_breakdown"],
    });
  }

  const future = pkg.future.data;
  if (future) {
    for (const est of future.value_forecasts.slice(0, 2)) {
      const g = future.growth_forecasts.find((x) => x.estimate_year === est.estimate_year);
      const epsBits = [
        est.eps_estimate !== null ? `EPS ${idr(est.eps_estimate)}` : null,
        g?.eps_growth != null ? `(${signedPct(g.eps_growth, 1)})` : null,
      ].filter(Boolean);
      const revBits = [
        est.revenue_estimate !== null ? `Revenue ${idrBig(est.revenue_estimate)}` : null,
        g?.revenue_growth != null ? `(${signedPct(g.revenue_growth, 1)})` : null,
      ].filter(Boolean);
      if (epsBits.length === 0 && revBits.length === 0) continue;
      rows.push({
        label: `Consensus estimate for ${est.estimate_year}`,
        value: epsBits.join(" ") || "—",
        compare: revBits.join(" ") || null,
        status: null,
        period: "Growth shown against the base year",
        tone: "neutral",
        paths: ["future.value_forecasts", "future.growth_forecasts"],
      });
    }
  }
  return rows;
}

// -- Earnings quality and balance sheet --------------------------------------

/** Cash conversion bands, from the forensic-accounting checklist the reference repos use. */
export const CASH_CONVERSION_STRONG = 0.85;
export const CASH_CONVERSION_WEAK = 0.7;

function yearLabel(pkg: ResearchPackage): string | null {
  const y = pkg.quality_metrics?.year;
  return y && ok(y) ? String(y.value) : null;
}

export function earningsQualityRows(pkg: ResearchPackage): FactRow[] {
  const q = pkg.quality_metrics;
  if (!q) return [];
  const rows: FactRow[] = [];
  const year = yearLabel(pkg);

  if (q.is_bank) {
    rows.push({
      label: "Free cash flow against profit",
      value: "Not shown for banks",
      compare: "A bank's cash flow includes customer deposits and loans, so it says little about earnings quality",
      status: "Not applicable",
      period: year,
      tone: "neutral",
      paths: [],
    });
  } else {
    if (ok(q.fcf_to_net_income_3y)) {
      const r = q.fcf_to_net_income_3y.value;
      rows.push({
        label: "Free cash flow as a share of net income",
        value: pct(r, 0),
        compare: `Added up over the last 3 years; ${pct(CASH_CONVERSION_STRONG, 0)} or more is strong, below ${pct(CASH_CONVERSION_WEAK, 0)} is weak`,
        status: r >= CASH_CONVERSION_STRONG ? "Strong cash conversion" : r >= CASH_CONVERSION_WEAK ? "Moderate cash conversion" : "Weak cash conversion",
        period: year ? `3 years to ${year}` : null,
        tone: r < CASH_CONVERSION_WEAK ? "differs" : "neutral",
        paths: ["quality_metrics.fcf_to_net_income_3y"],
      });
    }
    if (ok(q.fcf_margin)) {
      rows.push({
        label: "Free cash flow margin",
        value: pct(q.fcf_margin.value, 1),
        compare: "Free cash flow as a share of revenue",
        status: q.fcf_margin.value < 0 ? "Cash outflow" : null,
        period: year,
        tone: q.fcf_margin.value < 0 ? "differs" : "neutral",
        paths: ["quality_metrics.fcf_margin"],
      });
    }
  }

  const trend = (label: string, m: Measure, path: string): void => {
    if (!ok(m)) return;
    rows.push({
      label,
      value: signedPct(m.value, 1),
      compare: "Against the prior financial year",
      status: m.value > 0 ? "Growing" : m.value < 0 ? "Shrinking" : "Flat",
      period: year,
      tone: m.value < 0 ? "differs" : "neutral",
      paths: [path],
    });
  };
  trend("Revenue growth, full year", q.revenue_growth_yoy, "quality_metrics.revenue_growth_yoy");
  trend("Earnings growth, full year", q.earnings_growth_yoy, "quality_metrics.earnings_growth_yoy");
  return rows;
}

function band(value: number, low: number, high: number): "below" | "between" | "above" {
  return value < low ? "below" : value > high ? "above" : "between";
}

export function balanceSheetRows(pkg: ResearchPackage): FactRow[] {
  const q = pkg.quality_metrics;
  if (!q) return [];
  const rows: FactRow[] = [];
  const year = yearLabel(pkg);

  if (q.is_bank) {
    const bankRow = (label: string, m: Measure, path: string, note: string): void => {
      if (!ok(m)) return;
      rows.push({
        label,
        value: pct(m.value, 1),
        compare: note,
        status: null,
        period: year,
        tone: "neutral",
        paths: [path],
      });
    };
    bankRow("Capital adequacy ratio", q.capital_adequacy_ratio, "quality_metrics.capital_adequacy_ratio", "Capital held against risk-weighted assets, as published by Sectors");
    bankRow("Loan-to-deposit ratio", q.loan_to_deposit_ratio, "quality_metrics.loan_to_deposit_ratio", "Loans as a share of customer deposits, as published by Sectors");
    bankRow("CASA ratio", q.casa_ratio, "quality_metrics.casa_ratio", "Share of deposits held in current and savings accounts, as published by Sectors");
    bankRow("Net interest margin", q.net_interest_margin, "quality_metrics.net_interest_margin", "Interest earned less interest paid, against earning assets, as published by Sectors");
    return rows;
  }

  if (ok(q.net_debt)) {
    const nd = q.net_debt.value;
    rows.push({
      label: "Net debt",
      value: idrBig(nd),
      compare: nd < 0 ? "Cash exceeds debt" : null,
      status: nd < 0 ? "Net cash position" : null,
      period: year,
      tone: "neutral",
      paths: ["quality_metrics.net_debt"],
    });
  }
  if (ok(q.net_debt_to_ebitda)) {
    const v = q.net_debt_to_ebitda.value;
    const b = band(v, 2, 4);
    rows.push({
      label: "Net debt against operating earnings (EBITDA)",
      value: mult(v),
      compare: "Years of operating earnings needed to repay net debt",
      status: b === "below" ? "Below 2×" : b === "above" ? "Above 4×" : "Between 2× and 4×",
      period: year,
      tone: b === "above" ? "differs" : "neutral",
      paths: ["quality_metrics.net_debt_to_ebitda"],
    });
  }
  if (ok(q.interest_coverage)) {
    const v = q.interest_coverage.value;
    const b = band(v, 2, 3);
    rows.push({
      label: "Interest cover",
      value: mult(v),
      compare: "Operating profit divided by interest paid",
      status: b === "below" ? "Below 2×" : b === "above" ? "Above 3×" : "Between 2× and 3×",
      period: year,
      tone: b === "below" ? "differs" : "neutral",
      paths: ["quality_metrics.interest_coverage"],
    });
  }
  if (ok(q.debt_to_equity)) {
    const v = q.debt_to_equity.value;
    const b = band(v, 1, 2);
    rows.push({
      label: "Debt against shareholders' equity",
      value: mult(v),
      compare: "Total debt divided by equity",
      status: b === "below" ? "Below 1×" : b === "above" ? "Above 2×" : "Between 1× and 2×",
      period: year,
      tone: b === "above" ? "differs" : "neutral",
      paths: ["quality_metrics.debt_to_equity"],
    });
  }
  return rows;
}

const TITLE_LIMIT = 96;
const truncate = (s: string) => (s.length > TITLE_LIMIT ? `${s.slice(0, TITLE_LIMIT - 1)}…` : s);

/**
 * News, filings and corporate actions as one dated list, newest first. Shown
 * for timing only — never as a cause (CLAUDE.md "Not the product"). An item
 * that tags many symbols is marked, so it is not mistaken for news about this one.
 */
export function contextRows(pkg: ResearchPackage): FactRow[] {
  const ctx = pkg.context.data;
  if (!ctx) return [];

  const items: { category: string; date: string | null; text: string; specific: boolean; path: string }[] = [
    ...ctx.news.slice(0, 4).map((n) => ({
      category: "News",
      date: day(n.timestamp),
      text: n.title,
      specific: n.symbols_mentioned <= 1,
      path: "context.news",
    })),
    ...ctx.filings.slice(0, 4).map((n) => ({
      category: "Filing",
      date: day(n.timestamp),
      text: n.title,
      specific: n.symbols_mentioned <= 1,
      path: "context.filings",
    })),
    ...ctx.corporate_actions.slice(0, 4).map((a) => ({
      category: "Corporate action",
      date: day(a.date),
      text: a.detail,
      specific: true,
      path: "context.corporate_actions",
    })),
  ];
  items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  return items.slice(0, 8).map((item) => ({
    label: item.category,
    value: truncate(item.text),
    compare: item.specific ? "About this stock" : "Tags several stocks — not specific",
    status: null,
    period: item.date,
    tone: "neutral" as const,
    paths: [item.path],
  }));
}

/**
 * Macro and policy headlines, newest first, each linked to its source. Timing
 * context only — never a cause of the flow pattern.
 */
export function macroRows(pkg: ResearchPackage): FactRow[] {
  const macro = pkg.macro.data;
  if (!macro) return [];
  // Grouped by topic in the fixed topic order, newest first within each, and
  // never cut by date: a date-sorted slice dropped older regulation headlines
  // while the coverage card still counted them.
  const order = new Map<string, number>(MACRO_TOPICS.map((t, i) => [t.id, i]));
  const topicLabel = new Map<string, string>(MACRO_TOPICS.map((t) => [t.id, t.label]));
  return [...macro.items]
    .sort(
      (a, b) =>
        (order.get(a.topic) ?? 99) - (order.get(b.topic) ?? 99) || b.published_date.localeCompare(a.published_date)
    )
    .map((item) => ({
      label: topicLabel.get(item.topic) ?? item.topic,
      value: truncate(item.title),
      compare: item.publisher,
      status: null,
      period: item.published_date,
      tone: "neutral" as const,
      href: item.source_url,
      paths: ["macro.items"],
    }));
}

// -- What could not be measured ---------------------------------------------

const REASON_TEXT: Record<string, string> = {
  NO_SEARCH_PROVIDER: "no web-search provider is configured",
  NO_MACRO_RESULTS: "no dated headlines found in the review window",
  SEARCH_AUTH: "the search provider rejected its key",
  SEARCH_RATE_LIMIT: "the search quota was reached",
  SEARCH_TIMEOUT: "the search timed out",
  SEARCH_FAILED: "the search failed",
  NOT_RUN: "the research step did not run",
  NO_AVAILABLE_FIGURES: "no figures were available",
  NO_CLOSE: "no closing price",
  NOT_HELD: "not currently held",
  NO_ELIGIBLE_PEERS: "no peer qualified",
  NO_PEER_DATA: "no peer data",
  NO_NEARBY_CONTEXT: "nothing found nearby",
};

function reasonText(codes: string[]): string {
  if (codes.length === 0) return "no reason recorded";
  return codes.map((c) => REASON_TEXT[c] ?? c.toLowerCase().replace(/_/g, " ")).join("; ");
}

export function unmeasured(pkg: ResearchPackage): string[] {
  const out: string[] = [];
  const blocks: [string, { value_status: string; reason_codes: string[] }][] = [
    ["Company profile", pkg.identity],
    ["Valuation", pkg.valuation],
    ["Financials", pkg.financials],
    ["Analyst forecasts", pkg.future],
    ["Dividends", pkg.dividend],
    ["Peer set", pkg.peers],
    ["Subsector statistics", pkg.subsector],
    ["Nearby news and filings", pkg.context],
    ["Macro and policy context", pkg.macro],
  ];
  for (const [label, block] of blocks) {
    if (block.value_status !== "AVAILABLE") out.push(`${label}: not available (${reasonText(block.reason_codes)}).`);
  }

  const c = pkg.flow.components;
  if (!c) {
    out.push("Broker-flow structure: not scored yet.");
  } else {
    const parts: [string, { value_status: string; reason_codes: string[] }][] = [
      ["Concentration", c.concentration],
      ["Breadth", c.breadth],
      ["Persistence", c.persistence],
      ["Broker data coverage", c.coverage],
    ];
    for (const [label, block] of parts) {
      if (block.value_status !== "AVAILABLE") out.push(`${label}: not measurable (${reasonText(block.reason_codes)}).`);
    }
  }
  if (ok(pkg.peer_metrics.eligible) && pkg.peer_metrics.eligible.value === 0) {
    out.push("Peer comparison: no peer qualified, so no comparison is shown.");
  }
  return out;
}

// -- Watch list (code-built, no model call) ---------------------------------

export interface WatchSummary {
  rows: FactRow[];
  headline: string | null;
  bullets: string[];
}

export function watchSummary(pkg: ResearchPackage, extraRows: FactRow[] = []): WatchSummary {
  const all = [
    ...flowRows(pkg),
    ...fundamentalsRows(pkg),
    ...earningsQualityRows(pkg),
    ...balanceSheetRows(pkg),
    ...valuationRows(pkg),
    ...extraRows,
  ];
  const rows = all.filter((r) => r.tone === "differs" || r.tone === "gap");
  const gaps = unmeasured(pkg);

  if (rows.length === 0 && gaps.length === 0) return { rows, headline: null, bullets: [] };

  const differs = rows.filter((r) => r.tone === "differs").length;
  const headline =
    `${differs} ${differs === 1 ? "measure differs" : "measures differ"} from its baseline or peers; ` +
    `${gaps.length} ${gaps.length === 1 ? "area" : "areas"} could not be measured.`;
  return { rows, headline, bullets: gaps };
}

// -- Registry -----------------------------------------------------------

export const ROW_BUILDERS: Record<string, (pkg: ResearchPackage) => FactRow[]> = {
  position: positionRows,
  flow_structure: flowRows,
  fundamentals: fundamentalsRows,
  earnings_quality: earningsQualityRows,
  balance_sheet: balanceSheetRows,
  valuation: valuationRows,
  context: contextRows,
  macro: macroRows,
};
