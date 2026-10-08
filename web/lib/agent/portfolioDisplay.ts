/**
 * Fact tables for the portfolio-wide summary — the portfolio-level twin of
 * lib/agent/display.ts, with the same rule: every figure is formatted here,
 * the model only reads finished strings.
 *
 * The founding rule holds at this level too: concentration, breadth and
 * persistence are three separate rows, each its own list, never merged into
 * one ranking or one "riskiest holdings" view.
 */

import type { PortfolioPackage } from "@/lib/agent/portfolio";
import type { Measure } from "@/lib/agent/metrics";
import { count, idr, pct, signedIdr, signedPct } from "@/lib/format";
import { day, type FactRow } from "@/lib/agent/display";

function ok(m: Measure): m is Measure & { value: number } {
  return m.value_status === "AVAILABLE" && m.value !== null;
}

const SIGNED_PP = (fraction: number) =>
  `${fraction >= 0 ? "+" : "−"}${(Math.abs(fraction) * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;

export function overviewRows(pkg: PortfolioPackage): FactRow[] {
  const rows: FactRow[] = [];
  const t = pkg.totals;
  const period = day(pkg.as_of);

  if (ok(t.holdings_count)) {
    rows.push({
      label: "Holdings reviewed",
      value: count(t.holdings_count.value),
      compare: pkg.window_sessions !== null ? `Broker flow over the last ${count(pkg.window_sessions)} sessions` : null,
      status: null,
      period,
      tone: "neutral",
      paths: ["totals.holdings_count", "window_sessions"],
    });
  }
  if (ok(t.cost_basis)) {
    rows.push({
      label: "Total cost basis",
      value: idr(t.cost_basis.value),
      compare: null,
      status: null,
      period,
      tone: "neutral",
      paths: ["totals.cost_basis"],
    });
  }
  if (ok(t.market_value)) {
    rows.push({
      label: "Total market value",
      value: idr(t.market_value.value),
      compare: null,
      status: null,
      period,
      tone: "neutral",
      paths: ["totals.market_value"],
    });
  } else {
    rows.push({
      label: "Total market value",
      value: "Not available",
      compare: "At least one holding has no closing price",
      status: "Not measurable",
      period,
      tone: "gap",
      paths: [],
    });
  }
  if (ok(t.unrealised_pl)) {
    const pl = t.unrealised_pl.value;
    rows.push({
      label: "Unrealised profit / loss",
      value: signedIdr(pl),
      compare: ok(t.unrealised_pl_pct) ? signedPct(t.unrealised_pl_pct.value, 1) : null,
      status: pl > 0 ? "Above cost" : pl < 0 ? "Below cost" : "At cost",
      period,
      tone: "neutral",
      paths: ["totals.unrealised_pl", "totals.unrealised_pl_pct"],
    });
  }

  const v = pkg.verdict_counts;
  rows.push({
    label: "Broker-flow triage labels",
    value: `${count(v.Healthy)} Healthy · ${count(v.Watch)} Watch · ${count(v.Rebalance)} Rebalance`,
    compare: "Labels for how much broker-flow structure moved against each holding's own baseline",
    status: null,
    period,
    tone: "neutral",
    paths: ["verdict_counts"],
  });
  return rows;
}

function standoutValue(entries: { symbol: string; value: number }[], format: (v: number) => string): string {
  return entries
    .slice(0, 3)
    .map((e) => `${e.symbol} (${format(e.value)})`)
    .join(" · ");
}

export function standoutRows(pkg: PortfolioPackage): FactRow[] {
  const rows: FactRow[] = [];
  const s = pkg.standouts;
  const period = day(pkg.as_of);
  const note = "Each list is its own measure — not a ranking across measures";

  if (s.concentration.length > 0) {
    rows.push({
      label: "Selling concentration — furthest above own baseline",
      value: standoutValue(s.concentration, SIGNED_PP),
      compare: note,
      status: null,
      period,
      tone: "differs",
      paths: ["standouts.concentration"],
    });
  }
  if (s.breadth.length > 0) {
    rows.push({
      label: "Brokers changing side — largest share of active brokers",
      value: standoutValue(s.breadth, (v) => pct(v, 1)),
      compare: note,
      status: null,
      period,
      tone: "differs",
      paths: ["standouts.breadth"],
    });
  }
  if (s.persistence.length > 0) {
    rows.push({
      label: "Persistence — longest unbroken run of sessions",
      value: standoutValue(s.persistence, (v) => `${count(v)} ${v === 1 ? "session" : "sessions"}`),
      compare: note,
      status: null,
      period,
      tone: "differs",
      paths: ["standouts.persistence"],
    });
  }

  const gaps = Object.entries(s.not_measured);
  if (gaps.length > 0) {
    rows.push({
      label: "Could not be measured",
      value: gaps.map(([symbol, parts]) => `${symbol}: ${parts.join(", ")}`).join(" · "),
      compare: null,
      status: "Not measurable",
      period,
      tone: "gap",
      paths: ["not_measured"],
    });
  }
  return rows;
}

export function exposureRows(pkg: PortfolioPackage): FactRow[] {
  const rows: FactRow[] = [];
  const e = pkg.exposure;
  const period = day(pkg.as_of);

  for (const sub of e.by_subsector.slice(0, 5)) {
    if (!ok(sub.weight_pct)) continue;
    rows.push({
      label: `Subsector: ${sub.sub_sector}`,
      value: `${pct(sub.weight_pct.value, 1)} of cost basis`,
      compare: sub.symbols.join(", "),
      status: null,
      period,
      tone: "neutral",
      paths: ["exposure.by_subsector"],
    });
  }
  if (e.largest_position && ok(e.largest_position.weight_pct)) {
    rows.push({
      label: "Largest position by market value",
      value: `${e.largest_position.symbol} (${pct(e.largest_position.weight_pct.value, 1)})`,
      compare: null,
      status: null,
      period,
      tone: "neutral",
      paths: ["exposure.largest_position"],
    });
  }
  if (ok(e.unvalued_cost_share)) {
    const share = e.unvalued_cost_share.value;
    rows.push({
      label: "Cost basis in holdings with no closing price",
      value: pct(share, 1),
      compare: null,
      status: share > 0 ? "Part of the portfolio could not be valued" : "All holdings valued",
      period,
      tone: share > 0 ? "gap" : "neutral",
      paths: ["exposure.unvalued_cost_share"],
    });
  }
  return rows;
}

export interface PortfolioWatch {
  rows: FactRow[];
  headline: string | null;
  bullets: string[];
}

const BLOCK_NAMES: Record<string, string> = {
  flow: "broker-flow scoring",
  "flow.concentration": "concentration",
  "flow.breadth": "breadth",
  "flow.persistence": "persistence",
  "flow.coverage": "broker data coverage",
  identity: "company profile",
  valuation: "valuation",
  peers: "peer set",
  context: "nearby context",
};

/** Built entirely in code from the other tables, so it cannot repeat them in prose. */
export function watchRows(pkg: PortfolioPackage): PortfolioWatch {
  const rows = [...standoutRows(pkg), ...exposureRows(pkg)].filter((r) => r.tone === "gap" || r.tone === "differs");
  const bullets = pkg.not_measured.map(
    (entry) => `${entry.symbol}: ${entry.blocks.map((b) => BLOCK_NAMES[b] ?? b).join(", ")} could not be measured this run.`
  );

  const flagged = pkg.verdict_counts.Watch + pkg.verdict_counts.Rebalance;
  if (rows.length === 0 && bullets.length === 0 && flagged === 0) return { rows, headline: null, bullets };

  const total = pkg.holdings.length;
  const headline =
    `${count(flagged)} of ${count(total)} ${total === 1 ? "holding carries" : "holdings carry"} a Watch or Rebalance label; ` +
    `${count(pkg.not_measured.length)} ${pkg.not_measured.length === 1 ? "holding has" : "holdings have"} areas that could not be measured.`;
  return { rows, headline, bullets };
}
