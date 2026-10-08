import { getComponents } from "@/lib/data/source";
import { fetchComponents } from "@/lib/data/results";
import { fetchAgentRuns } from "@/lib/data/agentRuns";
import { buildPeerScreen } from "@/lib/agent/peerScreen";
import { computeVerdict, type Verdict } from "@/lib/verdict";
import type {
  ServeAlertEvidenceRecord,
  ServeComponentsRecord,
  ServePeerScreenRecord,
} from "@/lib/contract/types";

/**
 * The only thing the LLM ever sees for a symbol. Built as an explicit
 * whitelist rather than passed through from a fixture object, so the package
 * cannot silently grow a field the contract didn't intend to expose — per
 * CLAUDE.md, "if a figure isn't in the package, the LLM cannot state it."
 */
export interface AnalystPackage {
  symbol: string;
  trade_date: string;
  verdict: Verdict;
  summary: string;
  components: ServeComponentsRecord;
  evidence: ServeAlertEvidenceRecord[];
  peer_screen: ServePeerScreenRecord | null;
}

/**
 * Real scored components (`sectors/scoring.py`, via Supabase) take priority;
 * the fixture is only a fallback for the two symbols that still have one.
 * This is the fix for "No scoring data available for <symbol> yet": that
 * error used to fire for every held symbol except BBCA/ANTM because this
 * package was fixture-only, before real broker-flow scoring existed at all.
 */
export async function buildAnalystPackage(symbol: string): Promise<AnalystPackage | null> {
  const [real] = await fetchComponents([symbol]);
  const components = real ?? getComponents(symbol);
  if (!components) return null;

  // Peers come from the latest saved Run Analyst pass; the alert fixtures are
  // not read, so BBCA/ANTM-only text never reaches another symbol's chat.
  const savedRun = (await fetchAgentRuns([symbol])).get(symbol);

  return {
    symbol,
    trade_date: components.trade_date,
    verdict: computeVerdict(components),
    summary: "Scored from the saved broker-flow components.",
    components,
    evidence: [],
    peer_screen: savedRun ? buildPeerScreen(symbol, savedRun) : null,
  };
}

type ComponentBlockKey = "concentration" | "breadth" | "persistence" | "coverage";

const COMPONENT_FIELDS: Record<ComponentBlockKey, readonly string[]> = {
  concentration: ["share", "baseline_share", "top_n", "band", "band_count"],
  breadth: ["changed", "active", "share", "baseline_share"],
  persistence: ["same_direction", "of_sessions", "longest_run"],
  coverage: ["matched_share", "cohorts_available", "cohorts_total", "completeness"],
};

/**
 * Every `grounded_in` path the model is allowed to cite: fields that are
 * actually AVAILABLE in this package. Mirrors the rule the ANTM fixture
 * demonstrates in tests/fixtures/serve_narrative_v11.json — an UNAVAILABLE
 * block contributes no paths at all, so the model has no path to cite even if
 * it tried to guess the figure.
 */
export function allowedGroundedPaths(pkg: AnalystPackage): Set<string> {
  const paths = new Set<string>();
  for (const [block, fields] of Object.entries(COMPONENT_FIELDS) as [ComponentBlockKey, readonly string[]][]) {
    if (pkg.components[block].value_status === "AVAILABLE") {
      for (const field of fields) paths.add(`serve_components.${block}.${field}`);
    }
  }
  if (pkg.evidence.some((row) => row.value_status === "AVAILABLE")) {
    paths.add("serve_alert_evidence.buy_value");
    paths.add("serve_alert_evidence.sell_value");
    paths.add("serve_alert_evidence.net_value");
  }
  if (pkg.peer_screen) {
    paths.add("serve_peer_screen.shortlist");
    paths.add("serve_peer_screen.scorecard");
  }
  return paths;
}
