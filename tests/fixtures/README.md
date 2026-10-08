# Synthetic test fixtures

Every broker name, classification, and observation timestamp in the registry fixtures
is fabricated for tests. Broker codes may coincide with real codes; these rows
make no assertions about those brokers. The timestamps do not select a demo
end date or establish real classification history.

Snapshot directories have an unchanged UTF-8 `body.bin` and a SHA-256 manifest.
`synthetic-initial` has five brokers: one institutional, one retail, one mixed,
one explicit unknown, and one null cohort. Expected derived shares: 20%, 20%,
20%, 40%. `synthetic-changed` changes only the first broker's cohort.
Other fixtures exercise malformed JSON, wrong shape, duplicate codes, and
unexpected values. All are explicitly marked `source: synthetic`.

`daily-synthetic-valid.json` contains fabricated BBCA broker rows for the fixed
test date. It makes no claim about actual BBCA activity. Daily tests archive it
with synthetic provenance; any test database simulating real/local registry
provenance exists only in a temporary directory and still contains fabricated rows.

`serve_alert.json` and `serve_alert_evidence.json` are hand-written deterministic
examples of [serving contract `1.0.0-draft.1`](../../docs/serve-contract.md), under
review with Harfi. Both envelopes are labeled `SYNTHETIC_EXAMPLE`; none of their
records claims actual scored output or historically classified BBCA cohort values.
The selected symbol/date is real project scope, but scoring is pending and monetary
examples are invented. Null score/severity must remain null; unavailable evidence
must not be replaced by zero. These files do not seed database serving tables.

`research/` holds captured Sectors and Tavily responses (BBRI company report, peers,
subsector, news, filings, corporate actions, macro headlines) used by the web research
pipeline's tests. Unlike the files above they are real provider responses, not synthetic.
`web/scripts/sync-fixtures.mjs` copies them to `web/fixtures/research/`; this directory is
the source of truth, so new captures go here, never straight into `web/fixtures/`.
