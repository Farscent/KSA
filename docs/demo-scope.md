# Frozen demo universe

The BBCA / 2026-09-09 daily qualification milestone is complete and accepted for
the [demo operational policy](daily-qualification.md). The next milestone freezes
the demo scope, using the checked-in [configuration](../sectors/demo-scope.json)
as the single runtime source of truth.

| Setting | Frozen decision |
| --- | --- |
| Symbols | BBCA, BBRI, BMRI, BBNI, TLKM, ASII, ICBP, INDF, ANTM, MDKA |
| Fixed end date | 2026-09-09 |
| Initial lookback target | 20 IDX trading days ending on and including the fixed end date |

The scope is frozen to make the demo reproducible, bound later acquisition work,
and keep collaborators working against the same symbols and historical endpoint.
It does not roll forward with today's date or automatically expand to new symbols.
Changing it requires an explicit project decision and a reviewed configuration
change; tests pin the approved values. This document describes the configuration,
not a second runtime configuration.

## Local loading and validation

```python
from sectors.demo import load_demo_scope

scope = load_demo_scope()
```

The loader reads the JSON beside the module, independent of the working directory,
and returns immutable symbols, a date, and a trading-day count. It validates exactly
10 unique uppercase, nonempty symbol codes including BBCA, a canonical ISO date,
and a positive integer lookback. Tests additionally pin the exact approved list,
end date, and 20-day target. Missing or malformed configuration fails locally;
the loader never fetches data or silently normalizes symbols.

## Trading-date prerequisite

The eventual date range must use verified IDX trading dates, including holiday
and exceptional-closure evidence, rather than naive weekdays or 20 calendar days.
No start date or enumerated trading-date list is asserted in this milestone.
The existing reviewed September calendar supported the one-day pilot; it does not
by itself establish the entire lookback window. Verify every applicable calendar
period before resolving the 20 dates. Symbol suspensions and missing observations
also require explicit treatment during later ingestion.

This initial data target does not replace the metric's 60 preceding trading-day
baseline or establish enough history for production scoring. The accepted BBCA
result does not prove availability or operational completeness for the other
symbols or dates, or external market-wide completeness.

## Credits and remaining work

The API credit grant is **1,000 hackathon team credits according to the official
competition rules**, as supplied in the project decision. Those rules were not
independently retrieved or rechecked during this offline milestone. The grant is
not a measurement of the remaining account balance — an actual live account
balance is still unconfirmed.

Per-endpoint cost is now verified from `docs.sectors.app` (see `AGENTS.md`'s
"Sectors API: rules that bind our code" for the full table), not inferred:
`broker-summary/{symbol}/` is 1 credit per <=14-day range, `foreign-flow/{symbol}/`
is 1 credit per <=90-day range, `company/report/` and `subsector/report/` are 1
credit per requested section, and a 404 still bills 1 credit while 400/401/403/429/
5xx are free. `ingest-prices --live` costs 10 credits for the frozen universe;
`ingest-flow --live` (broker-flow, `sectors/flow.py`) costs ~70 credits for the same
universe over the current ~90-day window. Practical rate limits and a live account
balance remain unconfirmed.

Broker-flow ingestion and scoring have now been run against live data for the
whole frozen universe: 70 credits spent once, every response archived under
`data/flow-cache/`, and `serve_components` / `serve_flow_series` populated with
real `MEASURED` rows. Re-running the scoring costs nothing, because the parse
replays from that archive.

Three provider behaviours surfaced only under live data — zstd-encoded bodies,
per-broker foreign/domestic split fields, and a handful of broker-days whose
entire core aggregate is null. All three are handled explicitly rather than
worked around; see `AGENTS.md` and `docs/decision-log.md`. The existing fixed
BBCA qualifier is not generalized by this configuration.
