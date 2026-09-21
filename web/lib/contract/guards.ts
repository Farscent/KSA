/**
 * Runtime validators mirroring tests/test_serve_contract.py and
 * tests/test_serve_contract_v11.py on the Python side. These exist so a
 * fixture that drifts from the contract fails loudly in the frontend too,
 * not just in the Python test suite. Hand-rolled rather than a schema
 * library: the rules are cross-field (e.g. UNAVAILABLE requires every value
 * in a block to be null) and read more clearly as explicit checks.
 */
import type {
  Envelope,
  ServeAlertRecord,
  ServeAlertEvidenceRecord,
  ServeComponentsRecord,
  ServeFlowSeriesRecord,
  ServePeerScreenRecord,
  ServePositionRecord,
  ServePriceHistoryRecord,
} from "./types";

export const MAX_EXACT_INTEGER = 9_007_199_254_740_991;
export const DEMO_SYMBOLS = new Set([
  "BBCA",
  "BBRI",
  "BMRI",
  "BBNI",
  "TLKM",
  "ASII",
  "ICBP",
  "INDF",
  "ANTM",
  "MDKA",
]);

export class ContractViolation extends Error {
  constructor(message: string) {
    super(`contract violation: ${message}`);
    this.name = "ContractViolation";
  }
}

function assertTrue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ContractViolation(message);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

export function assertEnvelope<Output extends string, Rec>(
  envelope: Envelope<Output, Rec>,
  output: Output
): void {
  assertTrue(envelope.output === output, `expected output "${output}", got "${envelope.output}"`);
  assertTrue(envelope.contract_status === "UNDER_REVIEW", "contract_status must be UNDER_REVIEW");
  // 1.2.0-draft.1 added MEASURED for batch-ingested data. Requiring
  // SYNTHETIC_EXAMPLE here would reject every real payload.
  assertTrue(
    envelope.data_kind === "SYNTHETIC_EXAMPLE" || envelope.data_kind === "MEASURED",
    "data_kind must be SYNTHETIC_EXAMPLE or MEASURED"
  );
  assertTrue(Boolean(envelope.description?.trim()), "description must be nonempty");
  assertTrue(Array.isArray(envelope.records), "records must be an array");
}

export function assertMoneyOrNull(value: unknown, opts: { allowNegative?: boolean } = {}): void {
  if (value === null) return;
  assertTrue(Number.isInteger(value), "monetary value must be an integer or null");
  assertTrue(Math.abs(value as number) <= MAX_EXACT_INTEGER, "monetary value exceeds safe integer range");
  if (!opts.allowNegative) {
    assertTrue((value as number) >= 0, "monetary value must be nonnegative");
  }
}

export function assertAlert(row: ServeAlertRecord): void {
  assertTrue(typeof row.symbol === "string" && /^[A-Z]+$/.test(row.symbol), "symbol must be uppercase letters");
  assertTrue(isIsoDate(row.trade_date), "trade_date must be YYYY-MM-DD");
  assertTrue(row.signal_state === "NOT_EVALUATED", "signal_state must be NOT_EVALUATED in this draft");
  assertTrue(row.score === null, "score must be null in this draft — never render it as zero");
  assertTrue(row.severity === null, "severity must be null in this draft — never render it as neutral/low-risk");
  assertTrue(row.scoring_status === "PENDING_DEFINITION", "scoring_status must be PENDING_DEFINITION");
  const reasonSet = new Set(row.reason_codes);
  assertTrue(reasonSet.has("SCORING_NOT_DEFINED") && reasonSet.has("SEVERITY_NOT_DEFINED"),
    "reason_codes must include SCORING_NOT_DEFINED and SEVERITY_NOT_DEFINED");
  assertTrue(Boolean(row.summary?.trim()), "summary must be nonempty");
  const q = row.qualification;
  assertTrue(q.safe_for_demo_analysis === (q.operational_completeness === "PASS"),
    "safe_for_demo_analysis must equal (operational_completeness === PASS)");
  assertTrue(q.externally_proven_complete === false, "externally_proven_complete must be false in this draft");
  assertTrue(q.external_reconciliation === "NOT_EVALUATED", "external_reconciliation must be NOT_EVALUATED");
}

export function assertEvidence(row: ServeAlertEvidenceRecord): void {
  assertTrue(row.currency === "IDR", "currency must be IDR");
  assertTrue(row.evidence_type === "COHORT_VALUE_SUMMARY", "evidence_type must be COHORT_VALUE_SUMMARY");
  assertTrue(["institutional", "retail", "mixed", "unknown"].includes(row.cohort), "invalid cohort");
  if (row.value_status === "AVAILABLE") {
    assertMoneyOrNull(row.buy_value);
    assertMoneyOrNull(row.sell_value);
    assertTrue(row.buy_value !== null && row.sell_value !== null, "AVAILABLE evidence must have non-null values");
    assertTrue(row.net_value === (row.buy_value as number) - (row.sell_value as number),
      "net_value must equal buy_value - sell_value");
    assertTrue(row.reason_codes.length === 0, "AVAILABLE evidence must have empty reason_codes");
  } else {
    assertTrue(row.buy_value === null && row.sell_value === null && row.net_value === null,
      "UNAVAILABLE evidence must have all three monetary fields null — never zero");
    assertTrue(row.reason_codes.includes("EVIDENCE_UNAVAILABLE"),
      "UNAVAILABLE evidence must carry the EVIDENCE_UNAVAILABLE reason code");
  }
}

export function assertPosition(row: ServePositionRecord): void {
  assertTrue(DEMO_SYMBOLS.has(row.symbol), "symbol must be in the frozen demo universe");
  assertTrue(row.currency === "IDR", "currency must be IDR");
  if (row.value_status === "AVAILABLE") {
    assertTrue(typeof row.close === "number" && row.close > 0, "AVAILABLE position must have a positive close");
    assertTrue(isIsoDate(row.close_date), "AVAILABLE position must have a close_date");
  } else {
    assertTrue(row.close === null && row.close_date === null,
      "UNAVAILABLE position must have null close/close_date — never render as Rp 0");
  }
}

export function assertPriceHistory(row: ServePriceHistoryRecord): void {
  assertTrue(DEMO_SYMBOLS.has(row.symbol), "symbol must be in the frozen demo universe");
  assertTrue(row.currency === "IDR", "currency must be IDR");
  assertTrue(Array.isArray(row.points), "points must be an array");
  if (row.value_status === "AVAILABLE") {
    assertTrue(row.points.length > 0, "AVAILABLE price history must have at least one point");
    assertTrue(row.reason_codes.length === 0, "AVAILABLE price history must have empty reason_codes");
  } else {
    assertTrue(row.points.length === 0, "UNAVAILABLE price history must have no points");
  }
  let previous = "";
  for (const point of row.points) {
    assertTrue(isIsoDate(point.trade_date), "price point must have an ISO trade_date");
    assertTrue(point.trade_date > previous, "price points must be ascending with no duplicate dates");
    previous = point.trade_date;
    assertTrue(
      Number.isInteger(point.close) && point.close > 0,
      "price point close must be a positive integer — a missing session is omitted, never zero"
    );
    assertTrue(
      point.volume === null || (Number.isInteger(point.volume) && point.volume >= 0),
      "price point volume must be a nonnegative integer or null"
    );
  }
}

function assertComponentBlock(
  block: { value_status: string; reason_codes: string[] },
  numericFields: Record<string, unknown>
): void {
  if (block.value_status === "AVAILABLE") {
    assertTrue(block.reason_codes.length === 0, "AVAILABLE component block must have empty reason_codes");
    for (const [key, value] of Object.entries(numericFields)) {
      assertTrue(value !== null, `AVAILABLE component block field "${key}" must not be null`);
    }
  } else {
    assertTrue(block.reason_codes.length > 0, "UNAVAILABLE component block must carry a reason code");
    for (const [key, value] of Object.entries(numericFields)) {
      assertTrue(value === null, `UNAVAILABLE component block field "${key}" must be null — never zero`);
    }
  }
}

export function assertComponents(row: ServeComponentsRecord): void {
  assertTrue(row.scoring_status === "PENDING_DEFINITION", "scoring_status must be PENDING_DEFINITION");
  assertComponentBlock(row.concentration, {
    top_n: row.concentration.top_n,
    share: row.concentration.share,
    baseline_share: row.concentration.baseline_share,
  });
  assertComponentBlock(row.breadth, {
    changed: row.breadth.changed,
    active: row.breadth.active,
  });
  assertComponentBlock(row.persistence, {
    same_direction: row.persistence.same_direction,
    of_sessions: row.persistence.of_sessions,
  });
  assertComponentBlock(row.coverage, {
    matched_share: row.coverage.matched_share,
  });
  assertTrue(row.coverage.basis === "MEASURED", "coverage.basis must be MEASURED, never an example value");
}

export function assertFlowSeries(row: ServeFlowSeriesRecord): void {
  if (row.value_status === "AVAILABLE") {
    assertTrue(row.points.length > 0, "AVAILABLE flow series must have at least one point");
  } else {
    assertTrue(row.points.length === 0, "UNAVAILABLE flow series must have an empty points array, not a flat zero line");
  }
}

export function assertPeerScreen(row: ServePeerScreenRecord): void {
  assertTrue(!row.shortlist.includes(row.symbol), "shortlist must not include the held symbol itself");
  assertTrue(row.screened >= row.excluded.length + row.shortlist.length,
    "screened must be at least excluded + shortlist");
  for (const metric of row.scorecard) {
    for (const cell of metric.cells) {
      if (cell.value_status === "AVAILABLE") {
        assertTrue(cell.value !== null, "AVAILABLE scorecard cell must have a non-null value");
      } else {
        assertTrue(cell.value === null, "UNAVAILABLE scorecard cell must have a null value, never zero");
      }
    }
  }
}
