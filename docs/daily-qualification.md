# BBCA / 2026-09-09 daily-data qualification

This experiment is restricted to one symbol and one date. It inspects what a
daily broker response represents; it does not calculate signals or populate
serving tables. Registry ingestion, history, and cache behavior are unchanged.

## Observed result

The user executed the authenticated command on 2026-09-11. The saved HTTP response
was independently replayed and inspected from the shared workspace. No additional
API request was needed for analysis.

| Item | Result |
| --- | --- |
| HTTP result | 200 |
| Observation ID | `6a6d9628-635f-4a9c-a7e3-49cef95bf7f4` |
| Retrieval UTC | `2026-09-11T10:40:22.512455Z` |
| Archived bytes | 3,392 bytes, gzip encoding; decoded only after archival |
| SHA-256 | `3ef04f1032405d35337b565c3ab44fed0d62f65806f6f0f3b63ffc54537df7dc` |
| Response identity | `BBCA.JK`, requested start/end, exactly one group dated `2026-09-09` |
| Rows / unique brokers | 76 / 76 |
| Current real registry | 88 brokers; latest applied snapshot `ddbf2561-10e0-4400-8816-3da9b678a29f`, observed 2026-09-11 |
| Present / absent vs registry | 76 / 12 |
| Unknown / duplicate broker codes | None / none |
| Missing required fields / invalid numeric values | 0 / 0; nulls are reported separately |
| Null required fields | 25 average-price fields: 24 `savg_per_share`, 1 `bavg_per_share` |
| Per-row net value / net lots | All 76 pass both documented identities |
| Buy / sell value | IDR 1,267,073,227,500 on each side; difference 0 |
| Buy / sell lots | 1,933,751 on each side; difference 0 |
| Buy / sell frequency | 33,227 on each side; difference 0 |
| COMPLETE? | No: schema-contract discrepancy and unresolved coverage/absence evidence |

Absent registry brokers are `AD, AP, BF, FO, GA, GI, IC, ID, OK, PF, PI, YO`.
These are absences from this response, not a list of proven missing trades.

All 76 returned rows have positive buy or sell value. Every null buy/sell average
occurs on a side with zero frequency, zero lots, and zero value. That pattern is
consistent with an undefined average for a side with no activity. The published
OpenAPI schema nevertheless requires those averages and does not declare them
nullable. The report preserves the nulls, flags `SCHEMA_INVALID`, and separately
explains the observed zero-activity association. It does not describe the gross
activity values as corrupt or replace an undefined average with zero.

The data is consistent with the documented active-broker daily population, and
its reported arithmetic is internally balanced. The response does not establish
market/session scope, absence of upstream omissions/truncation, historical
membership of the 12 absent brokers, or an independent matching turnover control.
Thus the final reason codes are `SCHEMA_INVALID`, `ABSENCE_SEMANTICS_UNRESOLVED`,
and `COVERAGE_UNRESOLVED`; `safe_to_call_complete` remains false.

The structured report is `data/qualification/BBCA-2026-09-09.json`; raw bytes and
provenance are in `data/daily-cache/6a6d9628-635f-4a9c-a7e3-49cef95bf7f4/`.
These real data artifacts remain ignored by Git.

## Request and execution

The exact unauthenticated request description is:

```text
GET https://api.sectors.app/v2/broker-summary/BBCA/?start=2026-09-09&end=2026-09-09
Accept: application/json
```

The raw API key is read only from `SECTORS_API_KEY` and sent in `Authorization`.
No broker filter, ranking limit, additional symbol, or other date is requested.
The command uses normal Requests defaults, refuses redirects, and streams the
response to preserve its entity-body bytes before content decoding. As in registry
fetching, only the established transient statuses and transport failures are
retried, within bounded attempts. Every complete HTTP response is archived;
permanent failures, including 403, are not retried.

Run from the repository root in the shell with the environment key configured:

```powershell
python -m sectors qualify-day --symbol BBCA --trade-date 2026-09-09 --live --refresh --registry-db data/sectors.sqlite3 --report data/qualification/BBCA-2026-09-09.json
```

Subsequent analysis can reuse the successful observation without API access:

```powershell
python -m sectors qualify-day --registry-db data/sectors.sqlite3 --report data/qualification/BBCA-2026-09-09.json
python -m unittest discover -s tests -v
python -m compileall -q sectors tests
```

For a specific observation, pass its directory to `--observation`. By default the
latest HTTP-200 observation in `data/daily-cache` is reused; schema-invalid successes
remain inspectable rather than silently being replaced. `--live` permits a fetch
only on cache miss; `--live --refresh` explicitly requests a new observation.
Malformed/incomplete manifests or checksum failures cannot be replayed. A cache
miss without `--live` never makes a request.

The command rejects other symbols/dates. It reads the current real registry in
SQLite read-only mode and refuses a synthetic or empty registry database. An exit
code of 0 means a report was produced without invalid input; `UNRESOLVED` is still
not `COMPLETE`. Invalid data or HTTP failure yields a report and exit 1. Missing
prerequisites/credentials fail before requesting data.

Replay this real observation without fetching again:

```powershell
python -m sectors qualify-day --observation data/daily-cache/6a6d9628-635f-4a9c-a7e3-49cef95bf7f4 --registry-db data/sectors.sqlite3 --report data/qualification/BBCA-2026-09-09.json
```

The expected exit code is 1 because the report flags the documented-schema
nullability discrepancy. That exit does not discard the report or archived data.

## Calendar evidence and limits

The reviewed [IDX-issued 2026 holiday calendar](https://suprasekuritas.co.id/storage/2026/01/Peng-00171-Libur-Bursa-2026-2.pdf)
is attachment Peng-00171/BEI.POP/09-2025, dated 2025-09-23, hosted by Supra
Sekuritas. Its September row specifies 22 trading days with no holidays except
Saturday/Sunday. The target is Wednesday, 2026-09-09, so it is an applicable
scheduled exchange trading date under this explicit calendar evidence.

This is not a generic weekday assumption. A reviewed calendar entry is required
before the command fetches data. The same document's footnote allows subsequent
exceptional closures. The evidence does not independently rule out such a closure
or a BBCA-specific suspension on that day. The report retains that distinction.

The calendar PDF was downloaded and visually inspected, including the September
row and footnotes. Exact public source bytes and retrieval manifests are under
`data/qualification-evidence`. The checked-in review record, source URLs,
retrieval timestamps, and SHA-256 hashes are in
[bbca-2026-09-09.json](../sectors/evidence/bbca-2026-09-09.json).

## What the endpoint documents

The [Sectors daily endpoint and its OpenAPI schema](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-summary-by-symbol)
describe an object with `symbol`, `start`, `end`, and a `data` array. Each day has
`date` and `summary`; each summary row has a broker code and the fields below.
No nullable numeric fields are declared. The code reports extra/missing fields,
wrong types, null required values, wrong symbol/date, duplicate groups, and malformed
rows. It retains and counts malformed rows where their container is identifiable;
unparseable row counts remain null rather than becoming zero.

| Fields | Documented meaning | Qualification treatment |
| --- | --- | --- |
| `bval`, `sval`, `nval` | Buy/sell/net value, IDR | Integers; gross values nonnegative; net may be signed. |
| `blot`, `slot`, `nlot` | Buy/sell/net lots | Integers; gross lots nonnegative; net may be signed. |
| `bfreq`, `sfreq` | Buy/sell frequency | Nonnegative integer counts; exact counting convention is not supplied. |
| `bavg_per_share`, `savg_per_share` | Buy/sell average per share | Finite nonnegative numbers; per-share IDR interpretation follows value currency. |
| `navg_per_share` | Net average per share | Finite number; do not infer its formula or impose positivity. |

Numeric strings, booleans, nulls, non-finite numbers, and negative gross activity
are not coerced. Raw source values remain in the response archive. The schema
defines integer activity fields, so fractional/float encodings there are flagged
for review rather than rounded into integers.

## Absence is not automatically missing data

Sectors describes the population as active brokers. Under that contract, an
inactive broker need not appear. Registry membership is not a requirement that
every registered broker trades BBCA each day. The report therefore lists brokers
absent from the current registry comparison without labelling their trades missing
or inserting zero rows.

For each absent broker, the response has no activity-zero/missing-data marker.
It cannot independently prove inactivity instead of an upstream omission. Nor
does today's observed registry establish historical membership. The report labels
the endpoint population `ACTIVE_BROKERS_ONLY`, but retains
`ABSENCE_SEMANTICS_UNRESOLVED` for individual absent brokers. An empty response
also cannot distinguish inactivity from unavailable data.

## Reconciliation and completeness decision

Each check has its own result and evidence basis:

- Per-row `nval = bval - sval` and `nlot = blot - slot` are directly documented
  definitions. Exact integer mismatches produce `RECONCILIATION_FAILED` and report
  the affected rows, reported net, and expected net.
- Aggregate buy/sell value, lots, and frequency are described separately as
  `OBSERVED_EQUAL` or `OBSERVED_DIFFERENT`. The documentation does not establish
  regular/negotiated/cash-board inclusion, sessions, or frequency counting rules.
  These totals are not unconditional equality assertions.
- Average reconstruction remains `NOT_EVALUATED`: lot conversion in this feed,
  rounding policy, and net-average definition have not been established.
- Independent stock-day control reconciliation remains `NOT_EVALUATED` until a
  trusted control with matching scope and units exists.

Invalid, null, duplicate, or ambiguously scoped inputs prevent affected checks
from producing misleading partial totals. Arithmetic may be evaluated independently
when unrelated fields are malformed, with schema findings still visible.

The report includes observation provenance, registry snapshot lineage, row and
unique-broker counts, present/absent/unknown/duplicate codes, null/missing fields,
invalid numeric fields, detailed schema findings, calendar evidence, units,
individual checks, absence interpretation, and explicit unresolved questions.
`broker_comparison_status` distinguishes full identifiable-code comparison from a
partial or unavailable comparison. Unknown codes are not silently removed.

Reason codes include `EMPTY_RESPONSE`, `SCHEMA_INVALID`, `DUPLICATE_BROKER`,
`UNKNOWN_BROKER`, `INVALID_NUMERIC_FIELD`, `RECONCILIATION_FAILED`,
`COVERAGE_UNRESOLVED`, `ABSENCE_SEMANTICS_UNRESOLVED`, and prerequisite/provenance
errors. Synthetic observations are visibly marked `SYNTHETIC_OBSERVATION`.

This experiment cannot issue `COMPLETE` merely because the response is nonempty,
all codes match, or buys equal sells. With the currently available API contract,
scope, truncation/upstream coverage, and an independent control remain unproven.
The report explicitly answers `safe_to_call_complete: false` and explains why.
This qualifies the evidence available; it does not approve a production coverage
policy or historical backfill.

## Observation storage

Each observation has a UUID directory under `data/daily-cache` containing
`body.bin` and `metadata.json`. The body is saved before decompression or parsing,
including gzip/deflate bytes when transmitted. Metadata includes requested
symbol/date, UTC retrieval time, endpoint and exact request URL, HTTP status,
SHA-256 of the archived bytes, source type, and a constrained content-encoding
label needed for replay. No authorization header, key, cookie, or proxy credential
is persisted. Unknown encodings are preserved and explicitly rejected for parsing.

The registry snapshot format and storage are untouched. The daily report is saved
separately; it does not add broker versions, daily facts, serving tables, backfill,
persistence, thresholds, anomaly/severity formulas, multi-symbol ingestion, or
application-triggered fetching.
