/**
 * Builds a `serve_peer_screen`-shaped record from the peers a Run Analyst pass
 * already saved. No network, no new credits: it only re-reads `peers` and
 * `peer_metrics` out of the package and formats them.
 *
 * Figures are Sectors' own, reported with attribution. A missing field is an
 * UNAVAILABLE cell, never a zero, and an excluded candidate always carries its
 * reason.
 */
import { idrBig, mult } from "@/lib/agent/display";
import type { PeerExclusion, PeerMetrics } from "@/lib/agent/metrics";
import type { ExcludedCandidate, ScorecardCell, ScorecardRow, ScorecardUnit, ServePeerScreenRecord } from "@/lib/contract/types";
import type { PeerCompany, Peers, ResearchBlock } from "@/lib/research/types";

export interface PeerScreenInput {
  peers: ResearchBlock<Peers> | null | undefined;
  peer_metrics: PeerMetrics | null | undefined;
}

function exclusionCode(ex: PeerExclusion): string {
  if (ex.code) return ex.code;
  // Runs saved before `code` existed carry only the reason text.
  return ex.reason.startsWith("non-positive") ? "NON_POSITIVE_PE" : "MISSING_RATIO";
}

interface MetricSpec {
  label: string;
  note: string;
  unit: ScorecardUnit;
  pick: (c: PeerCompany) => number | null;
  format: (v: number) => number | string;
}

const METRICS: MetricSpec[] = [
  { label: "P/E (trailing)", note: "Sectors, trailing twelve months", unit: "RATIO_LABEL", pick: (c) => c.pe_ttm, format: mult },
  { label: "P/B (latest quarter)", note: "Sectors, most recent quarter", unit: "RATIO_LABEL", pick: (c) => c.pb_mrq, format: mult },
  { label: "Market cap", note: "Sectors", unit: "RATIO_LABEL", pick: (c) => c.market_cap, format: idrBig },
  { label: "Net income", note: "Sectors, latest reported", unit: "RATIO_LABEL", pick: (c) => c.net_income, format: idrBig },
  { label: "Revenue", note: "Sectors, latest reported", unit: "RATIO_LABEL", pick: (c) => c.total_revenue, format: idrBig },
  { label: "Market cap, 1-year change", note: "Sectors, fraction of prior value", unit: "PERCENT", pick: (c) => c.yearly_mcap_chg, format: (v) => v },
];

function cell(company: PeerCompany, spec: MetricSpec): ScorecardCell {
  const raw = spec.pick(company);
  if (raw === null || raw === undefined || !Number.isFinite(raw)) {
    return { symbol: company.symbol, value: null, value_status: "UNAVAILABLE", reason_codes: ["NOT_REPORTED"] };
  }
  return { symbol: company.symbol, value: spec.format(raw), value_status: "AVAILABLE", reason_codes: [] };
}

/** Null when the run has no peer block at all (nothing to show, not "no peers"). */
export function buildPeerScreen(symbol: string, input: PeerScreenInput): ServePeerScreenRecord | null {
  const { peers, peer_metrics: metrics } = input;
  if (!peers || peers.value_status !== "AVAILABLE" || !peers.data || !metrics) return null;

  const companies = peers.data.companies;
  const self = companies.find((c) => c.is_self) ?? null;
  const candidates = companies.filter((c) => !c.is_self);
  const excludedSymbols = new Set(metrics.excluded.map((e) => e.symbol));
  const eligible = candidates.filter((c) => !excludedSymbols.has(c.symbol));
  const nameOf = new Map(candidates.map((c) => [c.symbol, c.company_name ?? c.symbol]));

  const excluded: ExcludedCandidate[] = metrics.excluded.map((e) => ({
    symbol: e.symbol,
    name: nameOf.get(e.symbol) ?? e.symbol,
    reason_code: exclusionCode(e),
    reason_text: e.reason,
    detail: "Excluded before comparison; not scored as zero.",
  }));

  const shown = self ? [self, ...eligible] : eligible;
  const scorecard: ScorecardRow[] = eligible.length === 0 ? [] : METRICS.map((spec) => ({
    label: spec.label,
    note: spec.note,
    unit: spec.unit,
    cells: shown.map((c) => cell(c, spec)),
  }));

  return {
    symbol,
    peer_set_label: peers.data.sub_sector ?? "Sub-sector peers",
    screened: candidates.length,
    excluded,
    shortlist: eligible.map((c) => c.symbol),
    scorecard,
  };
}
