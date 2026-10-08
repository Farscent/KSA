/**
 * The fixture-backed half of the contract data seam.
 *
 * Outputs the Python batch already produces are read from Supabase by
 * `lib/data/results.ts` and distributed through `lib/data/ResultsProvider.tsx`.
 * `serve_position` and `serve_price_history` moved there when real daily close
 * ingestion landed. Everything below is still awaiting a real scoring engine
 * and remains backed by the synced fixtures in web/fixtures/ (see
 * scripts/sync-fixtures.mjs); each one moves across as the batch starts
 * producing it, and no screen imports a fixture path directly.
 *
 * Per AGENTS.md: this is a reads-only seam, and it never calls the Sectors
 * API. Nothing here performs a network fetch to an external provider.
 */
import runEnvelope from "@/fixtures/serve_run_v11.json";
import alertEnvelope from "@/fixtures/serve_alert_v11.json";
import evidenceEnvelope from "@/fixtures/serve_alert_evidence_v11.json";
import componentsEnvelope from "@/fixtures/serve_components_v11.json";
import flowSeriesEnvelope from "@/fixtures/serve_flow_series_v11.json";
import peerScreenEnvelope from "@/fixtures/serve_peer_screen_v11.json";
import narrativeEnvelope from "@/fixtures/serve_narrative_v11.json";

import {
  assertAlert,
  assertComponents,
  assertEnvelope,
  assertEvidence,
  assertFlowSeries,
  assertPeerScreen,
} from "@/lib/contract/guards";
import type {
  Cohort,
  ServeAlertEnvelope,
  ServeAlertEvidenceEnvelope,
  ServeAlertEvidenceRecord,
  ServeAlertRecord,
  ServeComponentsEnvelope,
  ServeComponentsRecord,
  ServeFlowSeriesEnvelope,
  ServeFlowSeriesRecord,
  ServeNarrativeEnvelope,
  ServeNarrativeRecord,
  ServePeerScreenEnvelope,
  ServePeerScreenRecord,
  ServeRunEnvelope,
  ServeRunRecord,
} from "@/lib/contract/types";

const run = runEnvelope as unknown as ServeRunEnvelope;
const alerts = alertEnvelope as unknown as ServeAlertEnvelope;
const evidence = evidenceEnvelope as unknown as ServeAlertEvidenceEnvelope;
const components = componentsEnvelope as unknown as ServeComponentsEnvelope;
const flowSeries = flowSeriesEnvelope as unknown as ServeFlowSeriesEnvelope;
const peerScreens = peerScreenEnvelope as unknown as ServePeerScreenEnvelope;
const narratives = narrativeEnvelope as unknown as ServeNarrativeEnvelope;

let validated = false;
function validateOnce(): void {
  if (validated) return;
  assertEnvelope(run, "serve_run");
  assertEnvelope(alerts, "serve_alert");
  alerts.records.forEach(assertAlert);
  assertEnvelope(evidence, "serve_alert_evidence");
  evidence.records.forEach(assertEvidence);
  assertEnvelope(components, "serve_components");
  components.records.forEach(assertComponents);
  assertEnvelope(flowSeries, "serve_flow_series");
  flowSeries.records.forEach(assertFlowSeries);
  assertEnvelope(peerScreens, "serve_peer_screen");
  peerScreens.records.forEach(assertPeerScreen);
  assertEnvelope(narratives, "serve_narrative");
  validated = true;
}

export function getRun(): ServeRunRecord {
  validateOnce();
  return run.records[0];
}

export function getAlerts(): ServeAlertRecord[] {
  validateOnce();
  return alerts.records;
}

export function getAlert(symbol: string): ServeAlertRecord | undefined {
  validateOnce();
  return alerts.records.find((r) => r.symbol === symbol);
}

export function isFlagged(symbol: string): boolean {
  return getAlert(symbol) !== undefined;
}

export function getEvidence(symbol: string): ServeAlertEvidenceRecord[] {
  validateOnce();
  return evidence.records.filter((r) => r.symbol === symbol);
}

export function getComponents(symbol: string): ServeComponentsRecord | undefined {
  validateOnce();
  return components.records.find((r) => r.symbol === symbol);
}

export function getFlowSeries(symbol: string): ServeFlowSeriesRecord[] {
  validateOnce();
  return flowSeries.records.filter((r) => r.symbol === symbol);
}

export function getFlowSeriesForCohort(symbol: string, cohort: Cohort): ServeFlowSeriesRecord | undefined {
  return getFlowSeries(symbol).find((r) => r.cohort === cohort);
}

export function getPeerScreen(symbol: string): ServePeerScreenRecord | undefined {
  validateOnce();
  return peerScreens.records.find((r) => r.symbol === symbol);
}

export function getNarrative(symbol: string): ServeNarrativeRecord | undefined {
  validateOnce();
  return narratives.records.find((r) => r.symbol === symbol);
}
