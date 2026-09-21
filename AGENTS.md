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

1. The frontend never calls the Sectors API directly — all external API usage is in the
   scheduled Python batch. If you're writing frontend code that wants "fresh" data, wire it
   to trigger/read the batch's output, not a live Sectors call.
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
