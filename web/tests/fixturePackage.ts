import { peerMetrics, positionMetrics, qualityMetrics, valuationMetrics } from "@/lib/agent/metrics";
import type { ResearchPackage } from "@/lib/agent/package";
import {
  projectDividend,
  projectFinancials,
  projectFuture,
  projectIdentity,
  projectNearbyContext,
  projectPeers,
  projectSubsector,
  projectValuation,
} from "@/lib/research/project";
import { unavailable } from "@/lib/research/types";
import type { ServeComponentsRecord } from "@/lib/contract/types";

import overview from "@/fixtures/research/bbri_overview.json";
import peersValuation from "@/fixtures/research/bbri_peers_valuation.json";
import ffd from "@/fixtures/research/bbri_financials_future_dividend.json";
import subsector from "@/fixtures/research/banks_subsector.json";
import news from "@/fixtures/research/bbri_news.json";
import filings from "@/fixtures/research/bbri_filings.json";
import corporateActions from "@/fixtures/research/bbri_corporate_actions.json";

/**
 * A full ResearchPackage built from the captured BBRI fixtures — real Sectors
 * responses, so tests and offline checks run at zero credits.
 */
const measuredBase = { basis: "MEASURED" as const, value_status: "AVAILABLE" as const, reason_codes: [] };

export const components: ServeComponentsRecord = {
  symbol: "BBRI",
  trade_date: "2026-10-07",
  scoring_status: "SCORED",
  concentration: { ...measuredBase, top_n: 3, share: 0.5692, baseline_share: 0.5188, band: 4, band_count: 5 },
  breadth: { ...measuredBase, changed: 23, active: 53, share: 0.434, baseline_share: 0.4396 },
  persistence: { ...measuredBase, same_direction: 5, of_sessions: 10, longest_run: 3, session_flags: null },
  coverage: { ...measuredBase, matched_share: 0.9999, cohorts_available: 4, cohorts_total: 4, completeness: "FULL" },
};

export function buildPackage(): ResearchPackage {
  const identity = projectIdentity(overview);
  const valuation = projectValuation(peersValuation);
  const peers = projectPeers(peersValuation);
  const sub = projectSubsector(subsector);
  const financials = projectFinancials(ffd);
  return {
    symbol: "BBRI",
    trade_date: "2026-10-07",
    verdict: "Watch",
    flow: { components, series: [] },
    position: positionMetrics({ lots: 15, avg: 4420 }, 4390, 20_000_000),
    identity,
    valuation,
    valuation_metrics: valuationMetrics(valuation),
    financials,
    quality_metrics: qualityMetrics(financials, identity),
    future: projectFuture(ffd),
    dividend: projectDividend(ffd),
    peers,
    peer_metrics: peerMetrics(peers, sub),
    subsector: sub,
    context: projectNearbyContext(news, filings, corporateActions),
    macro: unavailable("NO_SEARCH_PROVIDER"),
    provenance: [],
    steps: [],
    credits_used: 0,
  };
}

