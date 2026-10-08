# Agent Guardrails — KSA Sectors

Read `CLAUDE.md` first for what the project is and the current build order. This file is
about *who owns what* and the rules that must not be crossed while building it.

## Two owners, one contract

- **Farhan** owns ingestion and scoring: everything under `sectors/` (Python), DuckDB
  calculations, and writes to the Supabase results tables.
- **Harfi** owns the frontend: the Next.js/TypeScript app, and Supabase *reads* only.
- The only connection point between the two is the results tables in Supabase. An agent
  working on the engine side should never need to touch frontend code, and vice versa. If
  a change to the results schema is needed, treat it as a cross-cutting change: update the
  committed schema file and flag it, don't just alter a table shape silently.

## Hard rules

1. The **browser** never calls the Sectors API. Bulk historical ingestion — everything that
   feeds scoring — stays in the scheduled Python batch. The Next **server** may call Sectors
   for per-company research, but only through `web/lib/sectors/client.ts` and only via the
   cache-first, credit-metered wrapper in `web/lib/sectors/cache.ts`. If you add a call:
   go through `web/lib/sectors/endpoints.ts`, declare the credit cost from the table below,
   pass `sections=` explicitly, and never retry a 404.
2. The LLM narration layer never receives raw data and never performs calculations. It
   only takes a precomputed results package and writes sentences. If a number isn't
   already in that package, the LLM must not be asked to produce or estimate it.
3. News, filings, corporate actions, and suspensions are shown as context near an alert
   date, or used to *suppress* an alert as a scheduled-event false positive. They are never
   used to state or imply a cause for a flow anomaly.
4. No machine learning model in the scoring path. The rule set (concentration/breadth/
   persistence/z-scores) must stay deterministic and auditable — every number on screen
   traces back to a specific, explainable computation, not a model output.

## Task breakdown (adapted to the Python engine)

Engine side (Farhan / Python):

- Lock schema, demo stocks, date window — demo scope already frozen in
  `sectors/demo-scope.json`; confirm API credit quota before scaling ingestion.
- Hand-write 3 sample alerts as JSON to unblock frontend work before real scoring exists
  (extend the pattern in `tests/fixtures/serve_alert*.json`).
- Multi-stock, multi-day download/ingestion (currently single-stock/day only) with safe
  re-runs.
- Pull 60-day history for the 10 demo stocks; verify buys == sells per date before trusting
  any downstream number.
- Compute concentration/breadth/persistence/z-score features in DuckDB; spot-check a few
  rows by hand against a calculator before trusting the pipeline.
- Build and tune the alert rule — target a handful of real alerts firing on the demo
  window, not zero and not dozens.
- Add suppression for bad/incomplete data — broken input should surface as a visible
  warning, never a silently wrong number.
- Write finished results to Supabase.
- Peer screener with liquidity/data-quality eligibility filters; comparison scoring across
  multiple quarters; an explicit "no suitable alternative found" path proven on a thin
  subsector, not just the happy path.
- Corporate-action/suspension flags to label likely false alarms.
- Look back at how flagged stocks performed; write down sample-size limitations explicitly
  rather than implying a statistically proven result.

Frontend side (Harfi / Next.js, unchanged from the original plan):

- Portfolio input (stock, lots, average price), autocomplete, edit/delete, holding cap.
- Portfolio overview, alert detail with 60-day flow chart, severity breakdown by component
  (never collapse it into one opaque number).
- Data provenance strip (date, coverage, freshness) on every screen showing computed data.
- Comparison screen with excluded candidates and their exclusion reasons.
- Hold / Watch / Plan Swap actions that record intent only.
- News/filings context strip near alert dates.
- LLM runtime for stored explanations plus a follow-up chat that cannot state a number
  outside the delivered data package.
- Disclaimer ("decision support, not financial advice") on every screen.

## Known risks to sanity-check new code against

- **Broker category isn't the real owner** — a brokerage labeled institutional also
  handles retail clients. Never claim to know the underlying trader; show coverage
  percentages honestly instead.
- **No valid comparison may exist** — small subsectors can be all illiquid/unprofitable.
  Apply hard filters and return nothing rather than a misleading "best of a bad set."
- **Scheduled events look like anomalies** — index rebalancing, corporate actions, block
  trades. Require multi-day persistence before alerting, and check corporate-action/
  suspension flags before trusting a spike.
- **Stale financials** — quarterly reports lag trading data by months; always show the
  reporting period alongside any comparison that uses them.

## Definition of done for the anomaly engine

A severity score is not done until each component (concentration, breadth, persistence,
data coverage) is independently visible and explainable — not just a single aggregate
number. If you can't point to which component drove an alert, the scoring isn't finished.

## Sectors API: rules that bind our code

Source: `docs.sectors.app` — GenAI recipes 01–06, `recipes/api-security`, v2 endpoint
references. Fetched 2026-09-21.

### Billing (verified per-endpoint, not inferred)

| Endpoint | Cost |
|---|---|
| `company/report/{sym}/?sections=…` | **1 credit per section**; all 8 = 8 |
| `subsector/report/{slug}/?sections=…` | 1 per section; all 6 = 6 |
| `quarterly-financials/{sym}/` | 1 per quarter returned |
| `broker-summary/{sym}/` | 1 per call, **max 14-day range** |
| `broker-summary/{sym}/top/` | 2 per call, **no date limit** (period aggregate only) |
| `foreign-flow/{sym}/` | 1 per call, **max 90-day range** |
| `news/`, `filings/`, `corporate-actions/{sym}/` | 1 each |
| `daily-close/` (full universe) | 1 **per page**; ~32 pages/day — never use for a symbol subset |

Error billing: **404 costs 1 credit** (the lookup ran). 400 / 401 / 403 / 429 / 5xx are
**free**. Therefore: retry 429 and 5xx with exponential backoff freely; never retry a 404,
and never probe for a symbol's existence.

Always pass `sections=` explicitly. Omitting it bills all sections.

**Verified request paths** (guessing these costs a credit per wrong guess — four of ours
were wrong before checking the v2 reference):

| Purpose | Path and required params |
|---|---|
| Company report | `company/report/{SYM}/?sections=…` |
| Subsector report | `subsector/report/{slug}/?sections=…` (slug is kebab-case) |
| Quarterly financials | `financials/quarterly/{SYM}/?n_quarters=N` |
| News | `news/?extension=idx&symbols=BBCA,BBRI` — `extension` **required**, symbol filter is `symbols` (plural) |
| Filings | `filings/?symbol={SYM}` — `symbol` (singular) |
| Corporate actions | `company/corporate-actions/{SYM}/` — note the `company/` prefix |

`tests/live.test.ts` in `web/` checks these against the live API
(`SECTORS_LIVE=1 pnpm test`); run it if a section ever starts coming back UNAVAILABLE.

### Response realities that broke us once

- Bodies arrive **zstd**-encoded. Python 3.14's stdlib `compression.zstd` handles it;
  archives predating that support recorded `"unsupported"` and are recovered by magic
  number (`sectors/daily.py`).
- Broker rows carry **foreign/domestic split fields** (`f_*`, `d_*`) beyond the core
  schema. Permitted by name in `sectors/flow.py`; recorded but never scored.
- A few broker-days report the **entire core aggregate as null** while foreign fields carry
  values. That is "not reported", not "traded zero": exclude and count it, never sum it.
- **Broker buys equal sells exactly, every session.** Any metric built on a market-wide net
  direction is identically zero. Verify `sum(bval) == sum(sval)` before trusting a number.

For the ten-symbol demo universe over the current ~90-day/61-session ingestion window,
`/v2/broker-summary/{symbol}/`'s 14-day cap means 7 chunks per symbol — **70 credits for
real concentration/breadth/persistence across the whole universe** (`sectors/flow.py`).

### Auth and transport

- Key lives in `SECTORS_API_KEY` only — never hardcoded, never in a committed file, never in
  a query string. Header is `Authorization: <raw key>` — **no `Bearer` prefix**.
- HTTPS only; refuse redirects so the Authorization header is never forwarded
  (`sectors/registry.py:295` already does this — match it).
- Timeout 5s, exponential backoff from 1s on 429.
- Log endpoint, status, timestamp. **Never log the key, the full response, or query params.**
- Symbols normalize to bare uppercase: `bbca.jk` → `BBCA`.

### Broker flow: the zero-sum trap (Sectors' own words)

Sectors' GNN anomaly-detection recipe (part 3) states that summing all broker net values
"always produces a result near zero" because the market is zero-sum — the same premise as
this project's own thesis in `CLAUDE.md`. Their remedy is a `net_dominance` score (top
accumulator + top distributor) folded into one weighted
`0.5·GNN + 0.25·broker + 0.25·foreign` risk tier.

**We deliberately diverge**: `sectors/scoring.py` reports concentration, breadth and
persistence *separately*, never combined, because one number hides which component moved.
Cite the recipe as external validation of the premise; do not import its scoring.

### Agent-building patterns (recipes 01–06)

- **Tool-use RAG, not fine-tuning.** Wrap each endpoint as one narrow tool; the retrieval
  layer — not the model — is what makes output factual. Recipe 01 names the four failure
  modes this defends against: stale training data, hallucination, data exposure, missing
  domain precision.
- **Structured output is enforced, not requested** (recipe 04). Define the schema, validate
  the parse, and reject on failure. Field names and descriptions *are* prompt text — name
  them carefully. `SimpleJsonOutputParser`-equivalents do **no** validation on their own;
  ours must (see `web/lib/llm/narrate.ts`'s `validateNarration`).
- **Multi-agent = narrow roles in sequence** (recipe 03): screener → researcher → evaluator,
  with an evaluator returning `pass | expect_improvement | fail` and a bounded number of
  revision rounds, falling back to the last draft rather than failing outright. The
  narration retry loop in `web/lib/llm/narrate.ts` is the same shape — keep it, bound it.
- **Streaming** (recipe 05): stream at a granularity that parses. Partial JSON is invalid
  JSON — either stream whole objects (newline-delimited) or run the chunks through an
  incremental parser.
- **Memory** (recipe 06): storage / update / retrieval, keyed by session. Persist it; an
  in-memory dict is explicitly called out as not production. `agent_runs` is our equivalent.

### Rules this project adds on top

- Never ask the LLM to compute a ratio, a delta, or a target. Compute in code, pass the
  finished number, let the model write the sentence.
- Never state a figure that has no `grounded_in` path in the package. An `UNAVAILABLE`
  block contributes **no** paths, so "not measured" can never be rendered as "zero".
- Never call a broker cohort "institutions".
- Never claim a cause. News, filings and corporate actions are nearby context, and exist
  mainly to *suppress* false alarms.
