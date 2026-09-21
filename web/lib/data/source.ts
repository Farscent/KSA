/**
 * The only module in this app that knows where contract data comes from.
 * Backed today by the synced fixtures in web/fixtures/ (see
 * scripts/sync-fixtures.mjs). When real scored output lands in Supabase,
 * only this file changes — every screen and component calls these functions,
 * never a fixture path directly.
 *
 * Per AGENTS.md: this is a reads-only seam, and it never calls the Sectors
 * API. Nothing here performs a network fetch to an external provider.
 */
import runEnvelope from "@/fixtures/serve_run_v11.json";
import positionEnvelope from "@/fixtures/serve_position_v11.json";
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
  assertPosition,
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
  ServePositionEnvelope,
  ServePositionRecord,
  ServeRunEnvelope,
  ServeRunRecord,
} from "@/lib/contract/types";

const run = runEnvelope as unknown as ServeRunEnvelope;
const positions = positionEnvelope as unknown as ServePositionEnvelope;
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
  assertEnvelope(positions, "serve_position");
  positions.records.forEach(assertPosition);
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

export function getPositions(): ServePositionRecord[] {
  validateOnce();
  return positions.records;
}

export function getPosition(symbol: string): ServePositionRecord | undefined {
  validateOnce();
  return positions.records.find((r) => r.symbol === symbol);
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
