# One-stock-day completeness handoff

Owner: Farhan for evidence and ingestion; share the resulting data contract and
unresolved gaps with Harfi. The selected pilot is exactly BBCA / 2026-09-09.
The agreed demo policy below does not approve a backfill or production scorer.
See [daily qualification](daily-qualification.md) for archived evidence and replay.

## Demo operational gate

The existing BBCA observation passes all of these checks:

- [x] HTTP 200, correct symbol and requested dates, expected trading-day group,
  and a nonempty response. Preserve original body bytes and provenance.
- [x] Unique broker codes, no unknown codes, and a real current registry
  prerequisite: 76 returned brokers against 88 registered brokers.
- [x] Required activity fields have valid numeric types and values; documented
  per-row `nval = bval - sval` and `nlot = blot - slot` pass for all 76 rows.
- [x] Decision 1: accept null `bavg_per_share` only with `bval`, `blot`, and
  `bfreq` all valid integer zeros; accept null `savg_per_share` only with `sval`,
  `slot`, and `sfreq` all valid integer zeros. Preserve the null, never coerce it
  to zero. Any same-side activity, malformed value, or missing field remains
  invalid. Keep existing `navg_per_share` checks without inventing a formula.
- [x] Record the observed provider/schema deviation: 25 accepted side-average
  nulls (1 buy, 24 sell), with `VALID_WITH_KNOWN_PROVIDER_DEVIATION`.
- [x] Decision 2: accept the documented `ACTIVE_BROKERS_ONLY` population with
  `population_status: ACTIVE_BROKER_CONTRACT_ACCEPTED`. Keep all 12 absent codes
  in `registry_brokers_absent`, treated as not observed / presumed inactive for
  this symbol-day. Absence alone is not failure. Never synthesize rows or activity.
- [x] Reviewed trading-calendar prerequisite passes. Retain the caveat about
  exceptional closures and symbol suspensions.
- [x] Decision 3: report `operational_completeness: PASS`,
  `safe_for_demo_analysis: true`, and `OPERATIONALLY_COMPLETE`; offline replay
  exits 0. Failed operational checks produce `FAIL`, false, and exit 1.

Aggregate buy/sell equality is descriptive only, not a hard completeness rule:
common market/session scope and frequency conventions have not been established.
An independent stock-day control is not required for this demo gate.

## Claims still unproven externally

- [ ] Establish market/board/session scope, timezone/date boundaries, pagination,
  caps, and evidence against upstream omissions or hidden truncation.
- [ ] Obtain a trusted stock-day control with matching scope and units and resolve
  one-sided versus two-sided turnover definitions. Until then,
  `external_reconciliation: NOT_EVALUATED`. Balanced subsets alone do not prove
  full market-wide coverage.
- [ ] Establish historical broker membership and classification treatment. The
  current registry does not prove membership on the trade date, and presumed
  inactivity is not independently proven zero activity.
- [ ] Establish exceptional closures, suspensions, late arrivals, and revision
  semantics before broader historical ingestion.

`safe_to_call_complete: false` and `externally_proven_complete: false` remain in
the passing BBCA report. `COVERAGE_UNRESOLVED` is informational for demo analysis.
The observed provider deviation, our acceptance policy, and externally unproven
claims are separate findings. Do not extrapolate one day's result to 65 dates or
ten symbols. This change adds no scoring, serving tables, synthetic activity,
multi-symbol ingestion, or network requests.
