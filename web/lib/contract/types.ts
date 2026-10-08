/**
 * TypeScript mirror of the serve_* contract, versions 1.0.0-draft.1 and
 * 1.1.0-draft.1. See docs/serve-contract.md and docs/serve-contract-1.1.md in
 * the repo root — this file must stay field-for-field in sync with those, not
 * ahead of them. Nothing here invents a field the Python contract doesn't have.
 */

export type ContractVersion = "1.0.0-draft.1" | "1.1.0-draft.1" | "1.2.0-draft.1";
export type ContractStatus = "UNDER_REVIEW";
/**
 * `MEASURED` (1.2.0-draft.1) marks data ingested from the Sectors API by the
 * Python batch, as opposed to the hand-written `SYNTHETIC_EXAMPLE` fixtures.
 * It says the numbers were observed, not that they are complete — completeness
 * remains `value_status` and `reason_codes`' job.
 */
export type DataKind = "SYNTHETIC_EXAMPLE" | "MEASURED";

export interface Envelope<Output extends string, Record> {
  contract_version: ContractVersion;
  contract_status: ContractStatus;
  output: Output;
  data_kind: DataKind;
  description: string;
  records: Record[];
}

export type ValueStatus = "AVAILABLE" | "UNAVAILABLE";

// ---- serve_alert (1.0.0-draft.1, carried into 1.1.0-draft.1) ----

export type SignalState = "NOT_EVALUATED";
export type ScoringStatus = "PENDING_DEFINITION";
export type OperationalCompleteness = "PASS" | "FAIL" | "NOT_EVALUATED";
export type SchemaStatus =
  | "VALID"
  | "VALID_WITH_KNOWN_PROVIDER_DEVIATION"
  | "INVALID"
  | "NOT_EVALUATED";

export interface Qualification {
  operational_completeness: OperationalCompleteness;
  safe_for_demo_analysis: boolean;
  schema_status: SchemaStatus;
  population_status: "ACTIVE_BROKER_CONTRACT_ACCEPTED";
  external_reconciliation: "NOT_EVALUATED";
  externally_proven_complete: false;
  reason_codes: string[];
}

export interface ServeAlertRecord {
  symbol: string;
  trade_date: string;
  signal_state: SignalState;
  score: number | null;
  severity: string | null;
  scoring_status: ScoringStatus;
  reason_codes: string[];
  summary: string;
  qualification: Qualification;
  evidence_ids: string[];
}

export type ServeAlertEnvelope = Envelope<"serve_alert", ServeAlertRecord>;

// ---- serve_alert_evidence (1.0.0-draft.1, carried into 1.1.0-draft.1) ----

export type Cohort = "institutional" | "retail" | "mixed" | "unknown";

export interface ServeAlertEvidenceRecord {
  evidence_id: string;
  symbol: string;
  trade_date: string;
  cohort: Cohort;
  buy_value: number | null;
  sell_value: number | null;
  net_value: number | null;
  currency: "IDR";
  evidence_type: "COHORT_VALUE_SUMMARY";
  value_status: ValueStatus;
  reason_codes: string[];
  classification_basis: "SYNTHETIC_EXAMPLE";
  market_scope_status: "NOT_ESTABLISHED";
  title: string;
  explanation: string;
}

export type ServeAlertEvidenceEnvelope = Envelope<
  "serve_alert_evidence",
  ServeAlertEvidenceRecord
>;

// ---- serve_run (1.1.0-draft.1) ----

export interface RunWindow {
  sessions: number;
  start: string;
  end: string;
}

export interface ServeRunRecord {
  data_date: string;
  trade_date: string;
  window: RunWindow;
  symbols_requested: number;
  symbols_matched: number;
  cohorts_unavailable: number;
}

export type ServeRunEnvelope = Envelope<"serve_run", ServeRunRecord>;

// ---- serve_position (1.1.0-draft.1) ----

export interface ServePositionRecord {
  symbol: string;
  name: string;
  sector: string;
  close: number | null;
  close_date: string | null;
  currency: "IDR";
  value_status: ValueStatus;
  reason_codes: string[];
}

export type ServePositionEnvelope = Envelope<"serve_position", ServePositionRecord>;

// ---- serve_price_history (1.2.0-draft.1) ----

export interface PricePoint {
  trade_date: string;
  close: number;
  /** Null when the provider omitted it; never a stand-in zero. */
  volume: number | null;
}

export interface ServePriceHistoryRecord {
  symbol: string;
  /**
   * Ascending by trade_date, no duplicates. Non-trading days and sessions the
   * provider omitted are absent rather than zero-filled — a gap is an unknown,
   * not a value.
   */
  points: PricePoint[];
  currency: "IDR";
  value_status: ValueStatus;
  reason_codes: string[];
}

export type ServePriceHistoryEnvelope = Envelope<"serve_price_history", ServePriceHistoryRecord>;

// ---- serve_components (1.1.0-draft.1) ----

export type ComponentBasis = "EXAMPLE_VALUE" | "MEASURED";

interface ComponentBlockBase {
  basis: ComponentBasis;
  value_status: ValueStatus;
  reason_codes: string[];
}

export interface ConcentrationBlock extends ComponentBlockBase {
  top_n: number | null;
  share: number | null;
  baseline_share: number | null;
  band: number | null;
  band_count: number | null;
}

export interface BreadthBlock extends ComponentBlockBase {
  changed: number | null;
  active: number | null;
  share: number | null;
  baseline_share: number | null;
}

export interface PersistenceBlock extends ComponentBlockBase {
  same_direction: number | null;
  of_sessions: number | null;
  longest_run: number | null;
  session_flags: boolean[] | null;
}

export type Completeness = "FULL" | "PARTIAL" | "UNKNOWN";

export interface CoverageBlock extends ComponentBlockBase {
  matched_share: number | null;
  cohorts_available: number | null;
  cohorts_total: number | null;
  completeness: Completeness | null;
}

/**
 * serve_components' own scoring_status is wider than serve_alert's: once
 * `sectors/scoring.py` has actually measured concentration/breadth/
 * persistence/coverage for a symbol, the row carries "SCORED" rather than
 * the fixture-era "PENDING_DEFINITION". serve_alert's severity/score are
 * still undefined regardless, so ScoringStatus itself stays unchanged there.
 */
export type ComponentsScoringStatus = ScoringStatus | "SCORED";

export interface ServeComponentsRecord {
  symbol: string;
  trade_date: string;
  scoring_status: ComponentsScoringStatus;
  concentration: ConcentrationBlock;
  breadth: BreadthBlock;
  persistence: PersistenceBlock;
  coverage: CoverageBlock;
}

export type ServeComponentsEnvelope = Envelope<"serve_components", ServeComponentsRecord>;

// ---- serve_flow_series (1.1.0-draft.1) ----

export interface FlowPoint {
  trade_date: string;
  cumulative_net_value: number;
}

export interface ServeFlowSeriesRecord {
  symbol: string;
  cohort: Cohort;
  points: FlowPoint[];
  currency: "IDR";
  value_status: ValueStatus;
  reason_codes: string[];
}

export type ServeFlowSeriesEnvelope = Envelope<"serve_flow_series", ServeFlowSeriesRecord>;

// ---- serve_peer_screen (1.1.0-draft.1) ----

export interface ExcludedCandidate {
  symbol: string;
  name: string;
  reason_code: string;
  reason_text: string;
  detail: string;
}

export type ScorecardUnit = "IDR" | "SHARE" | "PERCENT" | "COUNT" | "RATIO_LABEL";

export interface ScorecardCell {
  symbol: string;
  value: number | string | null;
  value_status: ValueStatus;
  reason_codes: string[];
}

export interface ScorecardRow {
  label: string;
  note: string;
  unit: ScorecardUnit;
  cells: ScorecardCell[];
}

export interface ServePeerScreenRecord {
  symbol: string;
  peer_set_label: string;
  screened: number;
  excluded: ExcludedCandidate[];
  shortlist: string[];
  scorecard: ScorecardRow[];
}

export type ServePeerScreenEnvelope = Envelope<"serve_peer_screen", ServePeerScreenRecord>;

// ---- serve_narrative (1.1.0-draft.1) ----

export interface ServeNarrativeRecord {
  symbol: string;
  trade_date: string;
  paragraphs: string[];
  grounded_in: string[];
}

export type ServeNarrativeEnvelope = Envelope<"serve_narrative", ServeNarrativeRecord>;
