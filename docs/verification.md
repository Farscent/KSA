# Foundation verification

Verified locally on 2026-09-11 with Python 3.13 and its bundled SQLite. All registry
inputs were synthetic; HTTP behavior was mocked. No live Sectors API request was
made. Public API documentation was consulted for source-shape confirmation.

| Check | Result |
| --- | --- |
| `python -m unittest discover -s tests -v` | 30 tests passed. |
| `python -m compileall -q sectors tests` | Passed. |
| Initial synthetic CLI replay into a new demo DB | Five inserted versions. |
| Exact snapshot CLI replay | Zero new versions; `already_applied: true`. |
| Changed synthetic CLI replay | One changed broker, one new version. |
| Profile CLI | Five brokers: institutional 1/20%, retail 1/20%, mixed 1/20%, unknown 2/40%; explicitly registry shares. |
| Malformed snapshot CLI | Exit 1 with `MALFORMED_JSON`; no dimension update. |
| Local import followed by default cache use | Passed offline; five versions in a separate synthetic demo DB. |
| SQLite `integrity_check` / `foreign_key_check` | `ok` / no violations. |
| Final demo dimension | Six total versions, five current brokers. |

Tests cover strict source validation, duplicate codes/JSON keys, unexpected values,
null normalization with raw preservation, checksum/manifest errors, counts/shares,
empty-registry safeguards, exact and equivalent replay, every tracked attribute,
canonical hashing, half-open boundary joins, current/overlap SQL constraints,
out-of-order/equal-time rejection, snapshot identity collisions, missing brokers,
provenance isolation, rollback after a forced mid-refresh failure, and advancing
the observation watermark on unchanged attributes.

Mocked HTTP tests cover environment-only authorization, timeout propagation,
per-response byte preservation, retryable HTTP/transport failures, retry exhaustion,
permanent errors, malformed success, Retry-After limits, redirect refusal, absent
credentials, and disk failures without extra requests. CLI tests establish offline
replay and import/cache behavior and profile-only operation without DB creation.

Fixture body files are excluded from Git line-ending translation so snapshot
checksums remain valid across platforms. Generated caches, SQLite files, and
Python bytecode are ignored. Run commands are in [README.md](../README.md).

Limits: the initial offline checks above do not establish real API access or
registry values; the subsequent live result is recorded below. Account quota,
request limits, daily trading-data completeness, and historical classification
validity remain in the [decision log](decision-log.md).

## Live transport follow-up

The user reported a successful standalone `requests.get` to `/v2/subsectors/`,
while the original project client received Cloudflare 1010 at `/v2/brokers/`.
These use different endpoints, so the successful subsector request alone does
not prove broker access. The earlier suggestion to contact the provider was
premature before comparing the two clients.

Isolated the original HTTP request by substituting an in-memory socket, without
contacting Sectors. Its request construction differed from standard Requests:

| Setting | Original project | Standard Requests / fixed project |
| --- | --- | --- |
| HTTP method and target | GET `/v2/brokers/`, no query | Same |
| Authorization | Raw environment key, redacted in diagnostics | Same |
| Accept | `application/json` | Same |
| User-Agent on this runtime | `Python-urllib/3.13` | `python-requests/2.32.3` |
| Accept-Encoding on this runtime | `identity` | `gzip, deflate` |
| Connection | `close` | `keep-alive` |
| Request body | None | None |

Neither client was configured with an environment/effective proxy in this task.
The original code had no custom TLS, session adapters, browser emulation,
HEAD/OPTIONS calls, or preflight requests. The fixed client uses the installed
Requests defaults, including TLS verification and zero adapter retries, matching
the standalone example. No headers or credential values are saved in this report.

Changed only `fetch_live`, its HTTP imports, and removed the obsolete urllib
redirect handler. Added the Requests dependency declaration and adjusted transport
tests/documentation. Source hashes confirmed every other function/class in
`registry.py` remained unchanged, including capture, replay, validation, profiling,
versioning, cache selection, and retry-delay calculation. The HTTP status retry
set and attempt bounds are unchanged. Offline replay still works without Requests.

The prepared-request regression intercepts the actual Requests adapter after
request preparation and compares the standalone broker call with `fetch_live`.
At the same timeout their URL, GET method, complete header set, empty body, TLS,
proxy, and adapter settings match. The project intentionally retains timeout 15
seconds by default (the example uses 30) and `allow_redirects=False`. The latter
preserves the existing no-forwarding behavior and does not change the initial
HTTP request. See [Requests parameters](https://requests.readthedocs.io/en/latest/api/).

Verification: `python -m unittest discover -s tests -v` passed all 35 tests;
`python -m compileall -q sectors tests` passed. The original 30 cases remain, with
their HTTP mocks adapted to Requests. Five new cases cover prepared-request
equivalence, actual redirect refusal, one archived 403 with no database access or
mutation, whitespace rejection before transport, and dependency-free offline replay.

Live result: the user ran the fixed command in their configured PowerShell and
received HTTP 200 at `2026-09-11T10:24:16.618622Z`. The local snapshot and database
were subsequently verified without another API request:

- Snapshot ID: `ddbf2561-10e0-4400-8816-3da9b678a29f`.
- Snapshot SHA-256: `b03244d6fcf8d559ea57921f8aee48a665c75c70b4074d7681e721e4ff6b5890`;
  checksum and registry validation passed.
- Registry: 88 brokers; institutional 39 (44.32%), retail 5 (5.68%), mixed 42
  (47.73%), unknown 2 (2.27%). These are registry shares, not trading coverage.
- Refresh: 88 inserted versions, zero changed brokers, zero missing brokers.
- Database: 88 total/current versions, all from that snapshot; one applied
  snapshot; SQLite integrity `ok`, zero foreign-key violations, zero overlaps.
- Two cache warnings refer to archived 403 responses. They were rejected as
  registry input and did not prevent the successful observation from being applied.

Switching the client from urllib to standard Requests is now verified to support
a successful broker fetch/import. The specific individual header or transport
property behind the earlier 403 is not isolated by this result; no authenticated
side-by-side comparison of those individual differences was performed.

```powershell
python -m sectors registry --live --refresh --cache data/registry-cache --db data/sectors.sqlite3
```

## Original one-day completeness qualification (before demo policy update)

The fixed BBCA / 2026-09-09 experiment was implemented separately from the
registry layer and executed through the user's authenticated PowerShell. Full
request, calendar evidence, field meanings, observed findings, and replay command
are in [daily-qualification.md](daily-qualification.md).

- `python -m unittest discover -s tests -v`: all 54 tests passed, including all
  35 prior tests and 19 focused daily tests.
- `python -m compileall -q sectors tests`: passed.
- Calendar: reviewed IDX calendar explicitly supports the target as a scheduled
  trading day; extraordinary closures/symbol suspension remain distinguished.
- HTTP 200 observation `6a6d9628-635f-4a9c-a7e3-49cef95bf7f4`: exact 3,392-byte
  gzip body and SHA-256 verified before offline decompression and replay.
- Report: 76 rows and distinct brokers; 12 absent from the 88-broker current
  registry; no unknown or duplicate codes; no missing fields or invalid non-null
  numeric values. Twenty-five required averages are null, all on zero-activity
  sides, contrary to the non-nullable published schema.
- Every row passes documented net-value/net-lot arithmetic. Gross buy/sell value,
  lots, and frequency match as observations; no unsupported equality acceptance
  rule was added.
- Final offline replay regenerated the structured report with expected exit 1
  for the schema discrepancy. A network stub prevented any HTTP call during replay.
- File hashes confirmed registry DB, original daily body/manifest, registry code,
  and schema were unchanged by replay.

The report returns `SCHEMA_INVALID`, `ABSENCE_SEMANTICS_UNRESOLVED`, and
`COVERAGE_UNRESOLVED`, with `safe_to_call_complete: false`. No multi-day ingestion
or production scoring was implemented.

## Demo policy replay (2026-09-13)

The [agreed demo policy](decision-log.md#agreed-demo-data-quality-policy-2026-09-13)
supersedes the original blocking treatment above. No live API calls were made.

- `python -m unittest discover -s tests -v`: all 57 tests passed, including
  accepted null preservation, both sides' nonzero-activity rejection, operational
  gates, aggregate imbalance, and existing archive/retry/registry/SCD2 behavior.
- `python -m compileall -q sectors tests`: passed.
- The requested archived BBCA replay exited 0 and regenerated
  `data/qualification/BBCA-2026-09-09.json` as `daily-qualification-v2`.
- `qualification_status: OPERATIONALLY_COMPLETE`, `operational_completeness: PASS`,
  `safe_for_demo_analysis: true`, and all operational checks `PASS`.
- `schema_status: VALID_WITH_KNOWN_PROVIDER_DEVIATION`: all 25 raw null averages
  retained, with their original documented findings and accepted deviations;
  no blocking schema findings. No unknown or duplicate brokers.
- `population_status: ACTIVE_BROKER_CONTRACT_ACCEPTED`: 76 observed brokers,
  88 in the current registry, and all 12 absences still listed without synthetic
  rows or activity.
- `external_reconciliation: NOT_EVALUATED`, `safe_to_call_complete: false`, and
  `externally_proven_complete: false`. Reason codes are the informational
  `KNOWN_NULLABILITY_DEVIATION` and `COVERAGE_UNRESOLVED`.
