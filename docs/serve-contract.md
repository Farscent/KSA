# Application serving contract

Version: **`1.0.0-draft.1`**. Status: **UNDER_REVIEW with Harfi**.
This is a proposed application interface, not an approved scoring specification.
Farhan owns the eventual preparation of results; Harfi reviews consumption,
display semantics, and product decisions before this draft becomes stable.

## Outputs and boundaries

`serve_alert` describes the evaluation state of one symbol on one trading date.
It can contain an unevaluated result; the output name does not mean an alert fired.
Its grain and unique key are `(symbol, trade_date)` within a published version.

`serve_alert_evidence` provides supporting cohort value summaries. Its proposed
grain is `(symbol, trade_date, evidence_type, cohort)`; `evidence_id` is an opaque,
unique application identifier. An alert references zero or more evidence IDs.
IDs must resolve to evidence for the same symbol/date and contract version. The
application must not parse IDs for meaning or join internal broker/raw tables.

These are conceptual JSON outputs. No database tables, API routes, delivery
transport, scoring engine, ingestion, or frontend is implemented. Consumers use
prepared fields; reading them or clicking Run Scan must not initiate provider
fetches. Raw archive locations, SQL column names, registry snapshot IDs, and
provider response structure are not dependencies of this interface.

## Envelope and versioning

Both fixture files use the same envelope; all listed keys are required:

| Field | Type | Meaning |
| --- | --- | --- |
| `contract_version` | string | Exactly `1.0.0-draft.1` for this proposal. |
| `contract_status` | string | `UNDER_REVIEW`; not production approval. |
| `output` | string | `serve_alert` or `serve_alert_evidence`. |
| `data_kind` | string | `SYNTHETIC_EXAMPLE` in this draft; applies to every record and field. |
| `description` | nonempty string | Plain-text provenance and example limitations. |
| `records` | array of objects | Records for the named output; an empty array asserts no records, not zero activity or no signal. |

Draft consumers and tests match the version exactly. Review revisions increment
the draft suffix. Approval publishes a separate stable version; this draft does
not silently become production data. Proposed stable-version policy: breaking
field, unit, nullability, enum, grain, or semantic changes require a major version;
additive optional fields a minor version; documentation-only corrections a patch.
Harfi must agree compatibility and rollout behavior. Fixture tests reject extra
or missing keys in this exact draft. No generated timestamp is invented for these
hand-written examples; freshness and publication revision fields remain pending.

## `serve_alert` record

| Field | Type / draft values | Application meaning |
| --- | --- | --- |
| `symbol` | nonempty uppercase string | Exchange symbol without `.JK`; example `BBCA`. |
| `trade_date` | `YYYY-MM-DD` string | IDX trade-date label, not a timestamp. Calendar verification belongs upstream. |
| `signal_state` | `NOT_EVALUATED` | No signal decision was made. Evaluated states and transition rules are pending. |
| `score` | number or null; **null required in this draft** | Scoring formula, scale, direction, bounds, and rounding are pending. Null is not zero. |
| `severity` | string or null; **null required in this draft** | Labels, ordering, thresholds and relationship to score are pending. |
| `scoring_status` | `PENDING_DEFINITION` | Scoring/severity logic is undefined. This is separate from input qualification. |
| `reason_codes` | unique string array | This draft requires `SCORING_NOT_DEFINED` and `SEVERITY_NOT_DEFINED`. |
| `summary` | nonempty string | Plain text for display; no HTML, scoring claims, recommendation, or client-side parsing of prose. |
| `qualification` | object below | Prepared, application-facing data-quality summary. |
| `evidence_ids` | unique string array | Links to available evidence records, possibly empty; never evidence of a scored signal on their own. |

All fields are required, including explicit nulls. Harfi should render score and
severity as unavailable/pending, not zero, neutral, low risk, or an all-clear.
No alert ranking, bullish/bearish rule, or signal-triggering threshold is defined.

### Qualification object

| Field | Type / proposed values | Meaning |
| --- | --- | --- |
| `operational_completeness` | `PASS`, `FAIL`, `NOT_EVALUATED` | Result under the accepted demo data-quality policy. |
| `safe_for_demo_analysis` | boolean | True exactly when operational completeness is `PASS`; not evidence of scoring readiness. |
| `schema_status` | `VALID`, `VALID_WITH_KNOWN_PROVIDER_DEVIATION`, `INVALID`, `NOT_EVALUATED` | Distinguishes accepted zero-activity null averages from malformed data. |
| `population_status` | `ACTIVE_BROKER_CONTRACT_ACCEPTED` | Provider active-broker population is accepted by demo policy. |
| `external_reconciliation` | `NOT_EVALUATED` in this draft | No trusted matching-scope independent control established. |
| `externally_proven_complete` | false in this draft | Never promote operational success into an externally proven market-wide claim. |
| `reason_codes` | unique string array | Proposed codes below; carry quality caveats independently of scoring reasons. |

A `PASS` requires `VALID` or `VALID_WITH_KNOWN_PROVIDER_DEVIATION` schema status.
The latter requires `KNOWN_NULLABILITY_DEVIATION`; `COVERAGE_UNRESOLVED` preserves
the external-evidence caveat. Proposed other quality reasons are
`OPERATIONAL_CHECK_FAILED` for `FAIL` and `QUALIFICATION_NOT_EVALUATED` for
`NOT_EVALUATED`. This deliberately summarizes checks without forcing Harfi to
interpret internal reports. Detailed failed-check presentation is a review item.

The accepted policy preserves raw side-average nulls only when the same side's
value, lots and frequency are valid zeros. Absent registry brokers are presumed
inactive under the contract, not synthetic zero rows. Aggregate equality remains
descriptive. The current registry does not prove historical cohort membership.
The serving contract neither repeats raw rows nor changes these decisions.

## `serve_alert_evidence` record

| Field | Type / draft values | Application meaning |
| --- | --- | --- |
| `evidence_id` | nonempty string | Opaque stable link within this example publication. |
| `symbol`, `trade_date` | same types as alert | Identity used for linking; not inferred from the evidence ID. |
| `cohort` | `institutional`, `retail`, `mixed`, `unknown` | Broker intermediary cohort; not underlying investor identity. |
| `buy_value` | nonnegative integer or null | Gross cohort buy value in whole IDR. |
| `sell_value` | nonnegative integer or null | Gross cohort sell value in whole IDR. |
| `net_value` | signed integer or null | `buy_value - sell_value` when available; a descriptive identity, not a scoring formula. |
| `currency` | `IDR` | No scaling into thousands/millions in the payload. |
| `evidence_type` | `COHORT_VALUE_SUMMARY` | Descriptive cohort flow; no score contribution is implied. Additional evidence types are pending. |
| `value_status` | `AVAILABLE`, `UNAVAILABLE` | Availability of all three monetary fields, independent of scoring state. |
| `reason_codes` | unique string array | Empty when available; `EVIDENCE_UNAVAILABLE` when unavailable in this draft. |
| `classification_basis` | `SYNTHETIC_EXAMPLE` | No historical cohort mapping has been performed; production as-of semantics remain pending. |
| `market_scope_status` | `NOT_ESTABLISHED` | No market/board/session scope claim; eventual scope identifier needs agreement. |
| `title` | nonempty string | Short plain-text label. |
| `explanation` | nonempty string | Plain text explaining the displayed evidence and its limitations; not a formula or machine-readable decision. |

`AVAILABLE` requires all three values to be integers, with booleans and numeric
strings rejected, gross values nonnegative, and the net identity satisfied.
`UNAVAILABLE` requires all three to be null and the reason code; no partial totals
are presented as complete. An absent evidence row also does not mean zero.
Do not manufacture four zero-valued cohort rows or activities for absent brokers.
The four rows in the fixture demonstrate the cohort vocabulary only. The unknown
cohort's unavailable example does not mean unknown cohorts are always unavailable.

Numbers in this JSON proposal must be within the exact integer range
`[-9007199254740991, 9007199254740991]` for application compatibility. A producer
must not silently round larger values; agreeing a decimal-string alternative
before handling them is a review item. Aggregate buy=sell equality across
evidence records is not a contract invariant. No broker-average reconstruction,
concentration metric, historical mapping, or scoring calculation is implemented.

## Deterministic examples and validation

- [serve_alert.json](../tests/fixtures/serve_alert.json): one unevaluated BBCA /
  2026-09-09 record illustrating passing demo qualification with pending scoring.
- [serve_alert_evidence.json](../tests/fixtures/serve_alert_evidence.json): four
  hand-written synthetic cohort examples, including positive, negative, zero net,
  and unavailable values. They are not actual BBCA cohort totals or scored output.

The entire envelopes are labeled `SYNTHETIC_EXAMPLE`. Keep that label visible
when sharing or later displaying fixtures. No archive or current registry was
aggregated to create them. Fixture tests check exact shape/version, types, enums,
null rules, identity, example labels, arithmetic, and referential integrity.
They validate examples, not a production service or database schema.

## Product agreement needed with Harfi

1. Approve record grains, links, version compatibility, and eventual transport,
   publication revision, freshness, and missing-record behavior.
2. Define evaluated `signal_state` values, score formula/scale/precision,
   severity vocabulary/ordering, thresholds, and null/reason-code UX. Pending
   logic must not be filled by sample numbers or frontend calculations.
3. Agree quality badges and failure details; distinguish demo operational use,
   scoring readiness, and unproven external completeness in the application.
4. Agree historical cohort mapping and market/session scope for actual monetary
   evidence, availability handling, currency encoding limits, and future evidence
   types. Agree who owns display text and localization.
5. Resolve baseline, persistence, and missing-day treatment before scoring. The
   frozen 20-trading-day target does not supply the confirmed 60 preceding-day
   baseline or proposed 65-day persistence history.

Demo universe remains frozen; multi-stock ingestion and scoring remain pending.
No network fetch, production scoring, serving tables, or frontend work is part
of this milestone.
