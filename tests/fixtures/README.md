# Synthetic registry fixtures

Every broker name, classification, and observation timestamp in this directory
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
