/**
 * What this report rests on, what it could not rest on, and what a reader
 * could check next. Built entirely in code from the package's own statuses —
 * never sent to the model, never a grade or a confidence number.
 *
 * Shape (confirmed / gaps / next checks) follows ticker-dossier's research
 * quality gate; the content is ours. See docs/third-party-notices.md.
 */

import type { ResearchPackage } from "@/lib/agent/package";
import { unmeasured } from "@/lib/agent/display";

export interface EvidenceCoverage {
  confirmed: string[];
  gaps: string[];
  next_checks: string[];
}

function year(date: string): number | null {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
}

export function evidenceCoverage(pkg: ResearchPackage): EvidenceCoverage {
  const confirmed: string[] = [];
  const gaps: string[] = [];
  const next: string[] = [];

  // -- Broker flow ------------------------------------------------------
  const c = pkg.flow.components;
  if (c) {
    const measured = [
      c.concentration.value_status === "AVAILABLE" ? "concentration" : null,
      c.breadth.value_status === "AVAILABLE" ? "breadth" : null,
      c.persistence.value_status === "AVAILABLE" ? "persistence" : null,
    ].filter((x): x is string => x !== null);
    if (measured.length > 0) {
      confirmed.push(`Broker-flow ${measured.join(", ")} measured against this stock's own baseline (to ${c.trade_date.slice(0, 10)}).`);
    }
    if (c.coverage.completeness === "FULL") confirmed.push("Broker data coverage was full.");
    if (c.coverage.completeness === "PARTIAL") gaps.push("Broker data coverage was partial, so flow figures may understate what happened.");
    if (c.coverage.completeness === "UNKNOWN") gaps.push("Broker data coverage could not be determined.");
    if (c.concentration.basis === "EXAMPLE_VALUE") {
      gaps.push("Broker-flow figures are example values, not measured from real data.");
      next.push("Run the Python scoring batch (ingest-flow, score-flow, publish-flow) to replace the example values.");
    }
  } else {
    next.push("Run the Python scoring batch (ingest-flow, score-flow, publish-flow) so this symbol has broker-flow figures.");
  }

  // -- Sectors research ---------------------------------------------------
  const available: string[] = [];
  if (pkg.identity.value_status === "AVAILABLE") available.push("company profile");
  if (pkg.financials.value_status === "AVAILABLE") available.push("financials");
  if (pkg.valuation.value_status === "AVAILABLE") available.push("valuation");
  if (pkg.future.value_status === "AVAILABLE") available.push("analyst forecasts");
  if (pkg.dividend.value_status === "AVAILABLE") available.push("dividends");
  if (available.length > 0) confirmed.push(`Fetched from Sectors: ${available.join(", ")}.`);

  const eligible = pkg.peer_metrics.eligible.value;
  const screened = pkg.peer_metrics.screened.value;
  if (eligible !== null && screened !== null && eligible > 0) {
    confirmed.push(`Compared against ${eligible} of ${screened} peers.`);
  }
  if (pkg.peer_metrics.excluded.length > 0) {
    gaps.push(`${pkg.peer_metrics.excluded.length} peer(s) were excluded from the comparison for missing or non-comparable ratios.`);
  }
  if (eligible === 0) next.push("No peer qualified; choose comparable companies by hand before relying on a peer comparison.");

  // -- Staleness --------------------------------------------------------
  const finYear = pkg.financials.data?.ratio_year ? Number(pkg.financials.data.ratio_year) : null;
  const reviewYear = year(pkg.trade_date);
  if (finYear !== null && Number.isFinite(finYear)) {
    confirmed.push(`Annual financial statements are for ${finYear}.`);
    if (reviewYear !== null && reviewYear > finYear) {
      gaps.push(`Financial statements end ${finYear}; filings since then are not reflected in the annual figures.`);
      next.push("Check the latest quarterly report for results newer than the annual statements.");
    }
  }

  // -- Single provider ------------------------------------------------------
  if (available.length > 0) {
    gaps.push("Every research figure comes from one provider (Sectors) and was not cross-checked against a second source.");
  }

  // -- Everything else that could not be measured ------------------------------
  for (const line of unmeasured(pkg)) gaps.push(line);

  const macro = pkg.macro.data;
  if (macro) {
    confirmed.push(`${macro.items.length} macro and policy headlines found for ${macro.window_start} to ${macro.window_end}, each with its source link.`);
    next.push("Open the macro headlines to read what they say; they are timing context, not explanations.");
  } else {
    next.push("Read macro and policy news separately; this tool has no sourced feed for it.");
  }
  if (pkg.context.value_status === "AVAILABLE") {
    next.push("Open the cited filings and news to check what they actually say; they are timing context, not explanations.");
  }

  return { confirmed, gaps: [...new Set(gaps)], next_checks: [...new Set(next)] };
}
