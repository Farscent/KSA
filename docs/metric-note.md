# Portfolio review metric note

Status: definitions below are the confirmed foundation from the project request.
Proposed persistence and unresolved scoring choices remain visibly separate.
This document defines future metrics; the foundation implements registry ingestion
and observed broker classifications only.

## Purpose and ownership

Identify unusual broker-trading structure underneath stock holdings. Farhan owns
data ingestion and deterministic scoring. Harfi owns the application consuming
stable, agreed `serve_*` outputs. Interpretations describe observed intermediary
trading structure, with no price prediction, causal claims, or trading recommendations.

## Confirmed definitions

Input grain is `symbol × trade_date × broker_code`, within one explicitly fixed
market scope. Metric grain is `symbol × trade_date`. Scope boundaries and units
must be consistent across both sides, all brokers, and every date.

For each broker on the scored symbol/day:

```text
net_flow = buy_value - sell_value
net_selling_magnitude = max(sell_value - buy_value, 0)
active = buy_value > 0 or sell_value > 0
```

Let `S` be the sum of `net_selling_magnitude` over all net-selling brokers, including
institutional, retail, mixed, and unknown cohorts. If `S > 0`:

```text
seller_hhi = sum((broker_net_selling_magnitude / S)^2)
```

This is concentration of net-selling magnitude, not gross sell-value concentration
or an institutional-only measure. A zero denominator produces null plus a reason
code, never zero or a fabricated value.

Institutional-cohort sell breadth is:

```text
inst_sell_breadth = count(active institutional-cohort brokers with net_flow < 0)
                   / count(all active institutional-cohort brokers)
```

A broker with positive buys and sells is active even when its net flow is zero.
All active institutional brokers belong in the denominator. A zero denominator
produces null plus a reason code. The exact output reason-code vocabulary is still
to be agreed for `serve_*`; no production scoring contract is implied here.

The baseline is the preceding 60 exchange trading days, excluding the scored day.
An exchange calendar is required; these are not 60 calendar days or the latest
60 available rows after silently skipping missing days. Baseline statistics,
thresholds, and treatment of unavailable daily inputs are not yet specified.

Broker cohorts classify intermediaries, not underlying investor identities.
Foreign origin and institutional cohort are separate attributes. Keep mixed and
unknown brokers in full-universe accounting. With complete, consistently scoped
broker coverage, total buys and sells reconcile and net flows sum to zero subject
to explicit, justified unit/rounding tolerances. Cohort labels cannot break this
identity, and balanced totals alone do not prove completeness.

The registry's broker counts and cohort shares describe registry composition.
They do not measure active-broker participation, traded-value coverage, or data
completeness. Null source cohorts become unknown only in derived data. Current
classifications cannot silently be backdated to historical trading observations.

## Proposed, not approved

Persistence would count daily structural conditions met in the latest five exchange
trading days, including the scored day. Each of those five days needs its own prior
60-day baseline. Thus five fully evaluated conditions require at least 65 trading
dates: dates 61 through 65 are evaluated against their respective preceding windows.
This does not establish that 65 complete dates are currently available.

The daily structural condition itself is unresolved. Missing-day persistence policy
is also unresolved: do not silently skip a missing day, treat it as false, shorten
the window, or impute it. A count or severity cannot be produced until those choices
are agreed and the required observations are proven complete.

## Pending before scoring

Thresholds, baseline comparison statistics, the daily rule, severity formula,
coverage acceptance policy, missing-day persistence policy, and historical cohort
mapping need explicit decisions. API quota and request limits, ten demo symbols,
end date, daily completeness, and classification-history assumptions remain in the
[decision log](decision-log.md). No defaults in code should be interpreted as
approval of these product or metric choices.
