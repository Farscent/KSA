# Foundation decision log

Recorded 2026-09-11. “Confirmed” denotes the user's metric/project requirements;
“implementation choice” denotes local engineering behavior for this milestone;
“proposed” and “pending” do not imply approval. No real data was fetched during
the initial foundation verification. A subsequent user-run live registry fetch
succeeded; see [verification.md](verification.md). Daily trading-data availability
has been observed for the BBCA pilot; broader availability remains unproven.

## Agreed demo data-quality policy (2026-09-13)

These decisions supersede the pilot's original fatal nullability and blocking
absence treatment. They were implemented using the existing archived observation
and offline fixtures, with no new network requests.

1. **Zero-activity average nullability.** The observed provider deviation is 25
   null side averages despite the reviewed non-nullable schema. Our demo policy
   accepts null `bavg_per_share` only when `bval == 0 AND blot == 0 AND bfreq == 0`,
   and null `savg_per_share` only when `sval == 0 AND slot == 0 AND sfreq == 0`.
   Activity measures must be valid integer zeros. Preserve every raw null; never
   convert it to zero. Record `KNOWN_NULLABILITY_DEVIATION` and
   `VALID_WITH_KNOWN_PROVIDER_DEVIATION` when no blocking errors remain. Any
   nonzero same-side activity or malformed/missing required value remains invalid.
   No new formula or validation rule is added for `navg_per_share`.
2. **Active broker population.** Accept the documented `ACTIVE_BROKERS_ONLY`
   contract as `ACTIVE_BROKER_CONTRACT_ACCEPTED`. Absent registered brokers remain
   in `registry_brokers_absent`, not observed / presumed inactive for the symbol-day.
   Absence alone does not fail qualification. Never synthesize rows or activity.
   Current registry membership does not prove historical membership; presumed
   inactivity is not an externally proven zero-activity fact.
3. **Operational completeness.** Require HTTP 200, matching request identity,
   expected trading-day group, nonempty response, unique/known broker codes,
   valid activity numerics and schema under decision 1, passing per-row net-value
   and net-lot identities, and reviewed-calendar / real-registry prerequisites.
   Passing yields `OPERATIONALLY_COMPLETE`, `operational_completeness: PASS`, and
   `safe_for_demo_analysis: true`; failure yields `FAIL` and false. Aggregate
   buy=sell equality remains descriptive because common market/session scope is
   not established. An independent control is not required for demo eligibility.

The archived BBCA / 2026-09-09 observation passes this operational policy: 76
unique active brokers, 88 in the current registry, 12 listed absences, no unknowns
or duplicates, and all 25 null averages on verified zero-activity sides. Replay
exits 0. This accepts a provider deviation for demo use; it does not establish a
new provider guarantee or externally prove market-wide completeness.
`external_reconciliation: NOT_EVALUATED`, `safe_to_call_complete: false`, and
`externally_proven_complete: false` remain until independent market-wide evidence
actually demonstrates completeness. Scope, upstream coverage and historical
membership remain unproven. No scoring, serving tables, multi-symbol ingestion,
synthetic activity, or new requests are part of this change.

## Confirmed requirements

| Topic | Decision |
| --- | --- |
| Ownership | Farhan: ingestion and deterministic scoring. Harfi: app consuming stable `serve_*` outputs. |
| Metric definitions | Follow [metric-note.md](metric-note.md): fixed scope, stated grains and formulas, 60 preceding exchange trading days excluding the scored day. |
| Zero denominator | Null plus reason code; exact serving vocabulary still pending. |
| Interpretation | Broker intermediary classifications; no investor-identity inference, price prediction, causality, or trading recommendation. |
| Raw lineage | Preserve response bytes and provenance; normalize null cohort only downstream. |
| History | Record observed classification changes; no invented effective dates or silent historical backdating. |
| Delivery scope | Registry foundation and completeness handoff; no full backfill or production scoring yet. |

## Documentation evidence, not runtime proof

The [official registry documentation](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-registry),
checked 2026-09-11, documents the unfiltered registry endpoint, source fields,
nullable cohort/license type, and four cohort labels. It lists a one-credit request
cost. This does not establish account entitlement, remaining credits, quota, rate
limits, or the contents/completeness of a real response.

The [daily per-symbol documentation](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-summary-by-symbol)
describes daily rows for active brokers and a date range up to 14 days. That is a
candidate for the next-stage completeness experiment, not evidence that any chosen
stock-day is available or reconciles. Confirm the account's applicable constraints
before planning calls; do not extrapolate quota from the documented range.

## Implementation choices made for this milestone

| Choice | Behavior and rationale |
| --- | --- |
| Runtime/storage | Empty repo: Python standard library and SQLite. A subsequent live-transport fix uses `requests` for live fetching and transport tests; offline replay remains standard-library-only. |
| Capture | Fresh UUID per observation, exact bytes, SHA-256, UTC retrieval time, endpoint, HTTP status, provenance source; no headers/secrets in metadata. |
| Cache | Latest valid nonempty snapshot reused indefinitely unless explicit live refresh; selected age and invalid-entry warnings visible. No network on an offline miss. |
| Request resilience | Local default 15-second socket timeout, two retries; transient statuses only; bounded Retry-After; no redirects. These are client settings, not provider limits. |
| Validation | Reject entire snapshot on duplicate code, schema drift, malformed JSON, wrong types, or unexpected cohort. No silent row dropping or new-cohort coercion. |
| Empty response | Profile as zero brokers with null shares and `EMPTY_REGISTRY`; refuse dimension refresh. This is a registry safeguard, not the scoring coverage policy. |
| Canonical attributes | Hash name, foreign flag, derived cohort, license type. Null and explicit unknown cohort are equivalent in derived history; original values remain archived. |
| Time semantics | Observation timestamps in UTC; strictly increasing new snapshot application; identical applied snapshot replays allowed at any time. |
| Missing registry broker | Retain current version and report absence. Disappearance is not an approved deletion/closure signal. |
| Provenance isolation | Synthetic snapshots cannot mix with real/local observations in one database. |

## Frozen demo scope

Following acceptance of the BBCA one-day milestone, the user froze the demo
universe and fixed end date with an initial trading-day lookback target. The
[configuration](../sectors/demo-scope.json) is the single runtime source; see
[demo scope](demo-scope.md) for the approved values and verified-calendar
prerequisite. This milestone makes no network requests and does not implement
ingestion, scoring, serving tables, or frontend work.

## Serving contract draft under review

The first explicit application contract, [serve-contract.md](serve-contract.md),
is proposed as `1.0.0-draft.1` for review with Harfi. It defines `serve_alert` at
symbol/day grain and `serve_alert_evidence` at symbol/day/evidence-type/cohort
grain, with application identifiers independent of raw tables. Field names,
versioning, quality summaries, null handling, and display explanations are review
proposals, not approved scoring logic.

The two checked-in BBCA / 2026-09-09 fixtures are hand-written and labeled
`SYNTHETIC_EXAMPLE`. Monetary values and cohort assignments are fabricated;
qualification fields illustrate the demo policy rather than publishing an actual
scored result. Signal state is `NOT_EVALUATED`; score and severity are null with
`PENDING_DEFINITION`. No final formulas, thresholds, evaluated signal states or
severity labels are invented. Fixture validation implements no serving tables.

Harfi and Farhan still need to agree scoring state/scale/severity, reason-code
presentation, version compatibility, publication/freshness behavior, historical
cohort mapping, market scope, and display-text ownership. The demo universe stays
frozen. Multi-stock ingestion and scoring remain pending; there is no network
fetch, production scoring, or frontend implementation in this milestone.

## Proposed and pending decisions

| Topic | Status | Evidence or decision still required |
| --- | --- | --- |
| Five-day persistence | Proposed | Approve counting daily conditions in five trading dates including the scored date; five fully evaluated conditions require at least 65 trading dates. |
| Thresholds and baseline statistic | Pending | Define comparison statistic and thresholds; no numeric thresholds approved. |
| Daily structural rule | Pending | Agree exact logical condition combining approved measures. |
| Severity formula | Pending | Agree formula, scale, nullability, and interpretation. |
| Coverage policy | Demo policy agreed; external proof pending | Apply the three decisions above for one-day demo analysis; establish matching-scope independent evidence before claiming market-wide completeness. |
| Missing-day persistence | Pending | Decide whether/how incomplete days invalidate the five-day result; no silent omission or imputation. |
| API access/quota | Grant recorded; consumption pending | 1,000 hackathon team credits according to official competition rules, as supplied by the user. No independent rules/account check in this milestone; actual endpoint credit consumption, remaining balance, and rate limits remain to be confirmed. |
| Request limits | Pending | Confirm account rate/concurrency limits, pagination/caps, allowed range semantics, and retry budget before backfill planning. |
| Ten demo symbols | Frozen | User-approved list in the [demo configuration](../sectors/demo-scope.json). |
| End date and initial lookback | Frozen target; calendar resolution pending | Fixed values in the demo configuration; resolve the range from verified IDX trading dates, not naive weekdays. |
| Daily completeness | OPERATIONALLY_COMPLETE; external proof pending | The [one-day result](daily-qualification.md) is safe for demo analysis under the accepted nullability and active-population policy. Market/session scope, upstream completeness, historical membership and an independent control remain unproven. |
| Classification history | Pending | Establish whether dated effective classifications exist, first reliable observation, treatment before that time, and trade-date/as-of timestamp mapping. Observed current data is not historical truth. |
| Exchange calendar | Pending | Establish authoritative trading dates, sessions/timezone, holidays, suspensions, and missing-vs-zero activity semantics. |
| `serve_*` contract | Under review | Version `1.0.0-draft.1` and deterministic examples exist; Farhan and Harfi must agree pending fields and semantics before a stable version. |
| Multi-stock ingestion | Pending | Frozen demo scope only; resolve calendar and acquisition prerequisites before implementation. |
| Scoring | Pending | No production formulas, thresholds, state transitions, or severity mapping implemented. |

The fixed one-stock-day validator and archived observation now exist. Next concrete
step for external completeness: obtain market/session scope plus an independent
matching control. Demo operational acceptance is agreed; broader ingestion remains
a separate milestone. The future application must read prepared serving results;
Run Scan must not initiate live Sectors requests.

| Completeness pilot symbol | Confirmed | BBCA — selected as the first high-liquidity stock for daily broker-data qualification. |
| Completeness pilot date | Confirmed | 2026-09-09 — selected as a completed historical weekday with buffer from the latest session. Exchange-session validity must still be checked explicitly by the completeness workflow. |
| Completeness pilot scope | Confirmed | Exactly 1 symbol × 1 trade date. No backfill or scoring during this experiment. |

## Frontend design import — 2026-09-20

The Sectors Review Prototype design project (`claude.ai/design/p/0f176895-dd41-49f2-bc21-0364c023ad59`,
file `Sectors Review Prototype.dc.html`) was imported and used to plan the Next.js
frontend build. It resolves several previously open product questions. Four
decisions were made in reconciling it against the frozen scope and `CLAUDE.md`:

1. **Universe** — the prototype's own symbol list (14 tickers, including out-of-scope
   BBTN/UNVR/ADRO/PGAS/KLBF/SMGR and missing BMRI/MDKA) is **not** authoritative.
   The frontend is aligned to the frozen ten in `sectors/demo-scope.json`. The
   prototype's second flagged demo stock (BBTN) is replaced with an in-scope symbol.
   `sectors/demo-scope.json` itself is not re-frozen.
2. **Contract surface** — `1.0.0-draft.1` does not carry price, sector, company name,
   coverage percentage, component values, time series, or peer-screen data that the
   design renders. Contract `1.1.0-draft.1` is being drafted (see
   `docs/serve-contract-1.1.md`) as an additive extension — `1.0.0-draft.1` and its
   fixtures/tests are untouched. The frontend is built against `1.1.0-draft.1` fixtures.
3. **Portfolio valuation** — unrealized P&L, market value, a portfolio-value
   sparkline, and a sector-exposure donut are new surface not previously specified
   in `CLAUDE.md`. Kept, to be backed by real daily-close and sector data
   (`fetch-daily-close`, `fetch-companies`) rather than left illustrative. These are
   descriptive figures, not predictions, so the no-forecasting rule is unaffected.
4. **Severity metrics** — the design defines concentration as CR3 (top-3 broker
   share of sell value against a baseline share) and breadth as the count/share of
   brokers that changed side, and states there is no combined severity score,
   reporting components separately. This is adopted in place of `CLAUDE.md`'s prior
   `seller_hhi` / `inst_sell_breadth` / "severity score" wording, which is amended
   accordingly. `AGENTS.md` already required severity never be collapsed into one
   opaque number, so this aligns the two documents rather than introducing a new rule.

The frozen `lookback_trading_days: 20` does not supply the design's 60-session flow
chart. This is not resolved by re-freezing the scope; `serve_run.window` in the new
contract carries whatever window the batch actually produces (`sessions`, `start`,
`end`), and the frontend renders that window as given, rather than assuming 60.

## Run Analyst: a verdict label, not a combined severity score — 2026-09-21

"Run review" became "Run Analyst" (`web/components/RunReviewBar.tsx`): it now makes a
real per-symbol call — building each held symbol's already-computed
`serve_alert`/`serve_components`/`serve_alert_evidence`/`serve_peer_screen` package
(`web/lib/llm/package.ts`), narrating it with an LLM (OpenRouter, model
`openai/gpt-5.6-luna`, `web/lib/llm/narrate.ts`), and saving the result to a new
`public.agent_runs` table (`supabase/migrations/0003_agent_runs.sql`) — rather than the
previous hardcoded `setTimeout`.

This adds a three-tier **verdict** (`Healthy` / `Watch` / `Rebalance`,
`web/lib/verdict.ts`) shown on the position detail page. This is a triage label, not a
reintroduction of the combined severity score `CLAUDE.md` and `AGENTS.md` forbid: it is
computed deterministically from the components' own `band`/`band_count` and
`coverage.completeness` fields (not by the LLM, which is only ever told the verdict, never
asked to invent one), and the components continue to render separately underneath it,
unchanged. The LLM still never sees raw data and never does math — it receives only the
explicit whitelisted package in `lib/llm/package.ts`, and every number it states must
resolve to a `grounded_in` path present in that package (validated in
`web/lib/llm/narrate.ts` before anything is saved or shown).

The "Ask about this result" panel gained a per-symbol counterpart,
`web/components/AnalystChat.tsx`, for follow-up questions about a saved report,
grounded in that same package. The original portfolio-wide `AskPanel`/`answerFor`
keyword-matching (`web/lib/ask/answer.ts`) is unchanged — it answers about portfolio
totals and the flagged list, a different scope than a single symbol's saved report, so
folding the two together was left out of scope rather than forced.

## Real broker-flow scoring engine, and Run Analyst's fixture dependency — 2026-09-21

The user reported Run Analyst as broken in practice: for a portfolio holding BBRI, the
overview showed `Analyst run had a problem on at least one holding: No scoring data
available for BBRI yet.` Root cause: `web/lib/llm/package.ts`'s `buildAnalystPackage`
read `serve_components` only from `tests/fixtures/serve_components_v11.json`, which has
hand-written records for BBCA and ANTM only — every other held symbol returned `null`
and `web/lib/agent/actions.ts` turned that into a hard error before any LLM call.

This is fixed at the root rather than patched in the UI. Research into `docs.sectors.app`
(recorded in `AGENTS.md`'s new "Sectors API: rules that bind our code" section) found
`/v2/broker-summary/{symbol}/` costs 1 credit per <=14-day range — cheap enough (~70
credits for the whole ten-symbol universe over the ingested window) that real
concentration/breadth/persistence scoring, which `CLAUDE.md` had listed as "not yet
built," was affordable now rather than a future milestone.

Added:

- `sectors/flow.py` — generalises `sectors/daily.py` (hardcoded to `SYMBOL = "BBCA"`) to
  every frozen symbol, chunking the ingestion window into <=14-day calls per the
  provider's documented range limit. Cannot reuse `daily.inspect_schema` directly — it
  hardcodes the expected `symbol` response field as the literal `"BBCA.JK"` — so this
  module validates independently, reusing only `daily.py`'s row-shape constants.
- `sectors/scoring.py` — CR3 concentration, broker-side-flip breadth, trailing-window
  persistence, and registry-cohort coverage, each computed against a symbol's own window
  and each `UNAVAILABLE` (never a fabricated zero) when its own prerequisite is missing —
  a short window for persistence, no sell value for concentration/coverage, no prior
  session for breadth. Per this file's founding rule, the four components are computed
  and reported independently; there is no combined-score field anywhere in this module or
  its output tables.
- `supabase/migrations/0004_flow_results.sql` — `serve_components` / `serve_flow_series`,
  written by the batch (`sectors/publish.py`'s widened `RESULTS_TABLES`, new
  `publish_flow`), read-only to the app, matching `0001_results.sql`'s RLS pattern.
- `web/lib/data/results.ts` gained `fetchComponents`/`fetchFlowSeries`; the review layout
  (`web/app/(review)/layout.tsx`) now merges real Supabase rows with the fixture per
  symbol (real takes priority) before handing both down through `ResultsProvider`, and
  `buildAnalystPackage` now checks Supabase before falling back to the fixture. The
  contract's `ScoringStatus` type gained `"SCORED"` as a value distinct from the
  fixture-era `"PENDING_DEFINITION"` (`web/lib/contract/types.ts`,
  `web/lib/contract/guards.ts`) — the two coexist because `serve_alert`'s own
  score/severity remain genuinely undefined, only `serve_components`' scoring status
  changed.

Not done in this pass: nobody with `SECTORS_API_KEY` has actually run `ingest-flow
--live` yet, so the new Supabase tables are schema-correct but empty, and every symbol
still falls back to the BBCA/ANTM fixture until that live run happens. Verified instead
with synthetic/local archived observations end-to-end
(`tests/test_flow_pipeline.py`) and 16 new unit tests on hand-computed broker rows
(`tests/test_flow.py`, `tests/test_scoring.py`) — all 140 Python tests pass, `tsc
--noEmit`, `eslint`, and `next build` are all clean on the web side.

Also out of scope for this pass, and left for a follow-up: the user separately asked for
Run Analyst to become a visible, streaming "deep research" agent (live steps, company
fundamentals/peers/valuation/macro context, an expandable long-form report) modelled on
a supplied example equity-research report. That plan is recorded at
`~/.claude/plans/help-me-plan-for-cozy-dragonfly.md` (Parts 2-4) and was not built here —
it requires a live `SECTORS_API_KEY` and a new web-search provider key to test end to
end, neither available in this session, and is a separate-sized piece of work from the
root-cause fix above.

## The research pipeline, and three things only live data revealed — 2026-09-21

The previous entry left broker-flow ingestion unrun and the deep-research agent
unbuilt, both blocked on a `SECTORS_API_KEY`. The key now exists in
`web/.env.local`, so both were done. Two decisions and three bugs are worth
recording.

### Decision 1: the Next server may call Sectors, narrowly

`CLAUDE.md`'s architecture rule 1 said "the frontend never calls the Sectors API".
That rule is now **amended, not broken**: the *browser* still never calls Sectors,
but the Next *server* does, through `web/lib/sectors/client.ts` alone, and only via
the cache-first wrapper in `web/lib/sectors/cache.ts`.

Why amend rather than push this into the Python batch: the batch pre-fetches what
*scoring* needs across a frozen universe. Per-company research — profile,
financials, valuation, peers, nearby context — is fetched for the one symbol a user
is looking at, on demand. Pre-fetching all of it for all of IDX would cost far more
credits than fetching it lazily and caching it.

The mitigations are what make that safe, and they are not optional:

- **Cache-first.** `public.sectors_cache` (migration 0005) keys responses by
  `(endpoint, params_hash)`. A repeated Run Analyst pass over the same symbol
  spends **0 credits**. First pass is ~11 credits/symbol.
- **Hard ceiling.** `CreditLedger` enforces `SECTORS_RUN_CREDIT_CEILING`
  (default 25/symbol). Hitting it marks the remaining steps `skipped` with a reason
  code — it never silently truncates a report into looking complete.
- **Never retry a 404.** A 404 bills a credit because the lookup ran; 400/401/403/
  429/5xx are free, so backoff on those costs nothing. Encoded in `RETRY_STATUSES`.
- **Provenance.** Every fetch records `{endpoint, params, credits, cached,
  fetched_at}`, and the report's Sources section is rendered from that ledger in
  code — never written by the model.

`sectors_cache` carries the one RLS exception in this database: it is writable by
any authenticated user, because the Next server writes it using the caller's own
session. It holds public market data and no `user_id`, so the exposure is cache
poisoning, not disclosure. The alternative — putting a `SUPABASE_SERVICE_ROLE_KEY`
in the web environment — would hand the app a key that bypasses every RLS policy
here, which is a worse trade. Documented in the migration itself.

### Decision 2: persistence measures structure, because direction is identically zero

`scoring.py`'s `persistence_block` originally scored the *net direction* of each
session: `sum(bval - sval)` across all brokers, compared against the anchor day.
Against real data it returned `0/10, longest_run 0` for **all ten symbols**.

It was not a rounding bug. Broker buys and sells balance to the rupiah every single
session — verified directly: `sum(bval) == sum(sval)` exactly, on every trade date.
So the market-wide net is always 0, the anchor direction is always 0, and every flag
is false. This is precisely the zero-sum trap `CLAUDE.md`'s founding thesis names
and `AGENTS.md` warns to check for ("verify buys == sells per date before trusting
any downstream number") — and the scoring code walked straight into it.

Persistence now tracks the *structure*: whether each session's top-3 sell
concentration sat on the same side of that symbol's own baseline as the anchor
session did. "Same direction" keeps its literal meaning — same side of baseline —
over a quantity that actually varies. The results discriminate: ICBP 8/10 with a
run of 4 (sustained), BBCA 4/10 with a run of 1 (a one-day spike despite sitting in
band 5 of 5). A regression test (`test_zero_sum_nets_do_not_flatten_persistence`)
pins the property so this cannot come back.

### Three provider realities the synthetic tests could not have caught

1. **Responses are zstd-encoded.** `decoded_json` handled gzip and deflate and
   binned everything else as `CONTENT_ENCODING_UNSUPPORTED`, so all 70 paid-for
   chunks failed to parse. Python 3.14's stdlib `compression.zstd` decodes them with
   no new dependency. Archives written before this recorded `"unsupported"` rather
   than the real header, so `decoded_json` recovers those by magic number — a wrong
   guess cannot fabricate data, because decompression or `strict_json` fails. No
   credits were re-spent.
2. **Rows carry foreign/domestic splits.** Real rows have 22 fields, not the 12 in
   `daily.ROW_FIELDS`, and the parser demanded exact set equality — making every
   live response `SCHEMA_INVALID`. Now the core fields must be present and the ten
   known `f_*`/`d_*` fields are permitted by name, so an *unknown* new field is
   still a finding. They are recorded but never scored: the foreign/domestic split
   is `/v2/foreign-flow/`'s signal, not this metric's.
3. **Some broker-days report a wholly null core.** 23 of 35,006 rows have every core
   value null while the foreign fields carry data. That is "not reported", not
   "traded zero" — it crashed the sum, and coercing it to 0 would have invented a
   data point. Those rows are excluded and counted
   (`UNREPORTED_BROKER_ROWS ... never zero-filled`).

### Scope

Built: the cached client, endpoint wrappers, projections, deterministic metrics,
the `ResearchPackage` with a generalised `allowedGroundedPaths`, the step pipeline
as an `AsyncGenerator`, a six-section report, and the expandable `ReportView` with
per-section `grounded_in` footers.

Deliberately not built:

- **Live streaming of the step log.** *(Since built — see "Live research step log
  landed" below.)* The pipeline already yields step events and
  the UI shows the real post-hoc trace with true durations and credit costs, but
  events are not streamed as they happen. The generator shape exists so the route
  handler is a thin addition rather than a rewrite.
- **Macro and policy context.** No web-search provider key exists. The package
  declares a `macro` block that is permanently `UNAVAILABLE` with
  `NO_SEARCH_PROVIDER`, rather than omitting the section, so the gap is visible. A
  macro figure without a source URL is exactly the kind of number this system must
  never state.
- **Quarterly financials.** `quarterlyFinancials` is wired in
  `web/lib/sectors/endpoints.ts` but not called: it bills 1 credit per quarter and
  the annual series plus `yoy_quarter_*` already carry the growth figures.

Verified: 148 Python tests; 24 offline TypeScript tests against real captured
payloads in `web/fixtures/research/`; 2 live contract tests
(`SECTORS_LIVE=1 pnpm test`) that catch the provider renaming a path or a field;
`tsc --noEmit`, `eslint` and `next build` all clean.

## The portfolio summary is a second synthesis pass, not a bigger prompt — 2026-09-21

### Problem

Part 2 shipped a real per-symbol research pipeline, but Run Analyst reviews a
*portfolio* and produced nothing about the portfolio. It looped symbol by symbol,
wrote one `agent_runs` row each, and the dashboard showed a single line —
"3 holdings reviewed · 0 flagged" — with the actual prose reachable only by
clicking into a flagged holding. Two things made even that hard: `isFlagged`
still asked the two-symbol fixture whether a `serve_alert` existed, so real
`serve_components` rows for other symbols rendered "Stable" and the overview
table made those rows unclickable, and `RunReviewBar` returned `null` on a clean
run, hiding the research log at the exact moment someone would look for it.

### Decision

Add a portfolio-level synthesis: after the existing sequential per-symbol loop
finishes, run one more pass — `buildPortfolioPackage` in
`web/lib/agent/portfolio.ts` — over the `ResearchPackage`s that loop already
built, and narrate it section by section (`web/lib/llm/portfolioReport.ts`),
saved to a new `portfolio_runs` table and rendered on the dashboard itself
(`PortfolioReportView.tsx`), not on a detail page.

This costs **zero extra Sectors credits**: every figure the summary cites was
already fetched (and cached) for the per-symbol reports. It is a second
projection over data in hand, not a bigger prompt — the same "project down,
then narrate" shape as the per-symbol pipeline, one level up.

### Why not one bigger prompt across all holdings

A `HOLDINGS_CAP` of 15 full `ResearchPackage`s is far too much context for one
call, and it would also make the "no math in the LLM" boundary harder to audit —
every cross-holding number would need to be computed inside a single giant
projection instead of the same small, testable functions the per-symbol path
already uses. Digesting each package to ~20 fields first
(`digestOf` in `web/lib/agent/portfolioMetrics.ts`) keeps the model's input
small and keeps every derived number in TypeScript, tested in
`web/tests/portfolio.test.ts` against hand-built fixtures.

### Why there is no ranked "riskiest holdings" list

This is the place the project's founding rule — concentration, breadth and
persistence reported separately, never one severity score — is most tempting to
break. "Which of my holdings is riskiest?" is one combined score wearing a
different hat. `computeStandouts` returns three independent lists instead, one
per component, each naming which holdings moved furthest from *their own*
baseline on *that* component; a holding whose persistence could not be measured
appears in `not_measured`, never silently absent and never implicitly "fine".
No exported function in `portfolioMetrics.ts` takes more than one component as
input, and a test asserts exactly that shape.

### The keyword-matched Ask panel

`web/lib/ask/answer.ts`'s keyword matcher was tracked as a known gap in
`CLAUDE.md`. `askPortfolioFollowUp` now answers from the saved
`portfolio_runs.package` through the same `answerFollowUp` the per-symbol chat
already used — real narration, not string matching — once a portfolio summary
exists. The matcher stays as the pre-first-run fallback rather than being
deleted, since there's nothing saved yet to ground an LLM answer in.

### Scope

Built: `portfolio.ts`/`portfolioMetrics.ts`, `portfolioReport.ts`,
`portfolio_runs` (migration `0007`), `PortfolioReportView`, wiring in
`app/(review)/page.tsx`, every overview row made clickable (not only flagged
ones), `RunReviewBar` staying mounted on a clean run so the research log is
still inspectable, and the Ask panel pointed at real narration.

Deliberately not built: deriving `isFlagged` from real `serve_components`
instead of the two-symbol fixture — still a real gap (the "N flagged" count can
mislead), but a scoring-side change to the batch, and no longer able to hide a
report since navigation no longer depends on it.

Verified: `tsc --noEmit`, `eslint`, `next build` clean; 148 Python tests still
green; 32 vitest tests (8 new, over hand-built package fixtures) including one
that asserts no function in `portfolioMetrics.ts` combines two components into
a single score.

## Readable analyst report: fact tables, grounding check, quality sections

### Why

The first Run Analyst reports were hard to read. Reading the saved BMRI report
showed why: the model was handed raw JSON numbers and asked to write prose, so
it copied them out unformatted ("price-to-earnings ratio was 5.41242719491217",
"revenue of 174020000000000"), got a percent wrong by 100x ("unrealised P/L of
-45,000 (-0.006787330316742082%)"), wrote one dense paragraph per section with
no takeaway, and repeated the flow numbers again in "What to watch".

Comparing against the reference stock-research repos (see
`docs/third-party-notices.md`) showed a shared pattern: code formats every
number, facts go in a table and prose only says what they mean, the conclusion
leads, and status columns use a fixed vocabulary rather than raw deltas.

### What changed

Each report section is now **headline + fact table + at most three bullets**.

- The table is built in code (`web/lib/agent/display.ts`): every value is
  formatted, every comparison against a baseline or peer median is computed,
  every status comes from a fixed vocabulary with a stated tolerance (one
  percentage point for shares, 5% for multiples). The model never formats,
  converts or subtracts anything.
- The model sees only those finished rows and writes the headline and bullets
  (`web/lib/llm/reading.ts`). Its text is then checked in code
  (`web/lib/llm/grounding.ts`): a number that does not appear verbatim in the
  rows it was shown, or a phrase the compliance rules forbid, rejects the text.
  One retry names the problem; after that the section keeps its table and shows
  "written summary not available". An unverified sentence is never shown.
- `grounded_in` is now derived from the rows, not cited by the model.
- "What to watch" is built entirely in code from the other sections' rows, so
  it cannot repeat them in prose.
- The collapsed card leads with a **Key points** list (one headline per
  section) instead of one paragraph.
- Two sections added at zero extra credits, from annual fields Sectors already
  returned for `sections=financials` that `projectFinancials` used to drop:
  **Earnings quality** (free cash flow against net income over three years,
  FCF margin, full-year growth) and **Balance sheet and capital** (net debt,
  net debt against EBITDA, interest cover, debt against equity).
- **Banks are handled separately.** Their cash flow and debt include customer
  deposits and loans, so those measures return `NOT_APPLICABLE_BANK` rather than
  a number that would read as a finding; capital adequacy, loan-to-deposit,
  CASA and net interest margin, as published by Sectors, are reported instead.
  Sectors' `cost_to_income_ratio` is deliberately not shown: it reads 1.89 for
  BBRI against 0.52 for BBCA, and `efficiency_ratio` equals ROA in the payloads
  we hold, so both look wrong at the source.
- An **Evidence coverage** card (`web/lib/agent/coverage.ts`) lists what the
  report rests on, what could not be measured, and what to check next. It
  carries no grade and no confidence number.
- "Nearby context" is a dated table, newest first, with items that tag several
  stocks marked as not specific. It remains timing context, never a cause.

### Compatibility

`ReportSection` gained `headline`, `bullets`, `rows`; `paragraphs` is still
filled with `[headline, ...bullets]`, so the overview row detail, saved-run
history and older saved reports (paragraphs only) render unchanged. No
migration: `sections` and `package` are jsonb. `coverage` is read out of the
saved package with a JSON path (`package->coverage`), so history reads do not
pull whole packages.

### Deliberately not done

- No combined score, grade or confidence number anywhere in the new output.
- Not adopted from the references: bull/bear debate, investor-framework scores,
  backtests, indicators, prediction waterfalls, buy/hold/sell ratings.
- The "Healthy" verdict still reads `serve_alert`, which is fixture-only for
  two symbols, so BMRI can show "Healthy" beside a concentration band of 4 of 5.
  The new table makes the mismatch visible; fixing it means deriving alerts in
  the Python batch, which is separate work already listed in `CLAUDE.md`.

### Verified

`tsc --noEmit`, `eslint` and vitest clean (new tests for formatting, the
grounding check, quality metrics worked by hand, and coverage). A live
narration pass over the captured BBRI fixture package passed the grounding
check on every model-written section. The non-bank paths (cash flow, leverage)
are covered by hand-built tests only: no non-bank `sections=financials` payload
is in the cache yet, so their field names are unverified against live data.

## Symbol page: summary first, full analysis on a Details page

The per-symbol page carried eight equal-weight key points, an eleven-line
coverage card ahead of any finding, and the full report expanded inside a
narrow side column — too much to reach a conclusion from. It is now a one-screen
summary (`web/components/SummaryCard.tsx`, built in code by
`web/lib/agent/summary.ts` from the saved report's own rows): the broker-flow
finding, concentration / breadth / persistence side by side, at most three other
standouts, and a **View full analysis** button to `/[symbol]/details`, which
holds all sections, the coverage card, the past-runs picker and the cohort
table. Pattern taken from the references' "page 1" summaries; no model call,
credit or migration, and saved runs get the new layout without re-running.

- Standouts are listed in report order, never re-ranked by size: ordering unlike
  measures against each other would be a combined score by another name.
- Component cards now label themselves from each block's own `basis`
  (`measured` / `example`) instead of a hard-coded "example"; the "scoring not
  finalised" stamp shows only for non-measured components.
- The hand-written cohort table is shown only on Details, marked as example data.
- Latest-quarter growth rows are labelled "…, latest quarter" so they no longer
  read as contradicting the full-year growth rows (applies to new runs).

## Symbol page: price chart and key stats on our own data

The stock page now opens like a TradingView symbol page: last close and day
change, a price + volume chart with 1M / 3M / All tabs, and a key-stats panel,
above the analyst summary.

- Data is the daily closes already ingested into `serve_price_history`: zero
  Sectors credits, no batch change, no migration. The chart is drawn with
  TradingView's open-source `lightweight-charts`; the figures are ours.
- Sectors publishes close and volume only (no open/high/low), so there are no
  candlesticks, and history is the frozen ~61-session window, so no 1Y tabs.
  Both are stated on the page.
- The TradingView embed widget was rejected: its data is TradingView's, at
  today's date, so it would not match the frozen review date or the figures in
  the report, and its ratings gauges are buy/sell signals this product does not give.
- Header and performance figures are described as end-of-day closes, not live.
  A period with too few sessions shows "not enough data", never 0.
- Key stats reuse the saved report's own valuation and fundamentals rows plus
  the saved identity block; nothing is recomputed in the page.

### Symbol page layout follow-ups

- The chart is full width and 380px tall, with key stats in a compact three-column
  grid under it. A side-by-side layout left blank space under the chart whenever
  the stats list was longer. Key stats show a short fixed list (market cap, sector,
  sub-sector, listing date, P/E, P/B, forward P/E, EPS, ROE, net margin, dividend
  yield); peer comparisons stay in the full analysis and in hover text.
- A restyle with tinted tiles and pill statuses was tried and reverted: it looked
  worse than the plain bordered tiles. The page keeps the plain style and adds a
  short staggered entrance animation instead (`animate-rise` in `web/app/globals.css`,
  disabled under `prefers-reduced-motion`).
- The global `a { color }` rule is now inside `@layer base`. Unlayered CSS beats
  every Tailwind utility, so any link styled as a filled button with `text-white`
  rendered blue on blue (and dark blue on hover). Layered, utilities win again.
- Known gap: the header sentence still says "last 20 sessions" (from the fixture
  run window) while the chart covers all ingested sessions (61 for the demo window).

## Run status from saved runs, and History as its own area

### Why

Running the analyst changed nothing visible. The overview chip came from `isFlagged()`,
which read the two-symbol fixture, so BBCA/ANTM were always "Review" and the other eight
always "Stable"; the saved verdict went through the same fixture alert, so those eight were
always "Healthy". The dashboard also forgot a run on reload (its state was a browser
variable), and the "Past runs" dropdowns swapped report text while verdicts, totals and
charts beside it stayed current.

### Decisions

- Status is derived from the scored components in one place (`lib/flowStatus.ts`), as three
  independent signals with named constant cuts. Concentration keeps the existing top-40%
  band cut; breadth crosses when its share exceeds its own baseline by more than the
  existing 1-point tolerance; persistence crosses at 60% of trailing sessions in one
  direction (new constant — the batch publishes no persistence baseline). Breadth and
  persistence cuts are new and should be revisited against real data.
- `null` (not measurable) is kept apart from `false` (measured, not crossed), matching the
  coverage rule. Never a count or score across components.
- Status is read from the run's own saved components, so it reflects what the analyst saw;
  it becomes `Outdated` when the scored data date or the held lots differ from the run's.
- Verdict shown for a saved report is recomputed from its saved components
  (`savedVerdict`), so reports saved under the old fixture-dependent rule are not shown
  with a misleading "Healthy".
- History is a separate read-only area. Each Run Analyst pass generates one run id up
  front; per-symbol `agent_runs` rows carry it and the `portfolio_runs` row uses it as its
  primary key. No foreign key (per-symbol rows are written first; single-symbol runs have
  none). Migration `0009` backfills existing rows within 30 minutes of a matching portfolio
  run and leaves the rest null rather than guess.
- The layout reads only the latest run per symbol and the latest portfolio run; older runs
  are fetched on demand under `/history`.

### Not changed

The data window is frozen, so two runs over the same holdings will often be identical; the
History list says "No change from the previous run" in that case rather than inventing a
difference.

## Live research step log landed

The "live streaming of the step log" item above is built (commit `f484199`, hardened
afterwards). The generator shape did make the route a thin addition.

- **`fetch` + reader, not `EventSource`.** `EventSource` reconnects when the server closes
  the stream normally, which would silently re-run the pipeline and spend credits again.
- **POST, not GET.** A run spends Sectors credits and writes rows, so a link or prefetch
  must not trigger it. The route validates the ticker (`[A-Z]{4}`) and `runId` (UUID).
- **A "Writing report" step** is streamed around LLM narration and the save, which is the
  longest silent stretch. It is stream-only and not pushed into `pkg.steps`, so saved
  traces and History are unchanged.
- **Disconnects do not abort a run.** The credits are spent; the run finishes and saves.
- **Dashboard stays "running" through the portfolio summary**, so it no longer says
  "finished" while the synthesis pass is still writing.
- Network errors, a bad frame, or an expired session now return an error result instead of
  leaving the dashboard stuck on "Researching…".
- Removed the unused non-streaming `runAnalystForSymbol` / `runResearch`.

Still not streamed: LLM narration tokens (text is validated by `grounding.ts` only once
complete) and the portfolio synthesis pass.

## Macro and policy context: sourced headlines, keyed by date — 2026-10-08

### Problem

`macro` was a permanently `UNAVAILABLE` block (`NO_SEARCH_PROVIDER`): no search key was
read anywhere, so every report carried the same gap.

### Decision

- **Tavily**, via `TAVILY_API_KEY`, through `web/lib/search/tavily.ts` and the existing
  cache (`getOrFetch` gained an optional `fetcher`). Searches cost 0 Sectors credits, so the
  per-run ceiling is unaffected. No migration: the `sectors_cache` table is reused.
- **Headlines only.** The block keeps title, publisher, date and URL. A figure pulled out of a
  snippet would put raw text in front of the model and need a new verbatim-quote check; a
  headline with its link cannot be stated without its source.
- **Keyed by date window, not symbol.** Macro is the same for every holding, so one set of
  four searches (30 days to the review date) serves all ten symbols. The window ends at the
  review date so a run never shows news from after the data it reviews.
- Timing context only, like nearby news and filings: never a cause of the flow pattern.
- No key set: unchanged behaviour — `UNAVAILABLE` / `NO_SEARCH_PROVIDER`, shown as a gap.

### Not done

The portfolio-wide summary does not yet carry a macro section; each per-symbol report does.
