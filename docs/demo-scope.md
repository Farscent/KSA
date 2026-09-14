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
not a measurement of the remaining account balance. Actual API credit cost per
endpoint/request has not yet been independently established; endpoint consumption,
rate limits, and practical request budgeting remain to be confirmed. Do not infer
a number of affordable requests from the grant alone.

No new network fetch is part of this milestone. The `serve_*` contract,
multi-stock ingestion, scoring, serving tables, and frontend work remain pending.
The existing fixed BBCA qualifier is not generalized by this configuration.
