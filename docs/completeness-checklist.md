# One-stock-day completeness handoff

Owner: Farhan for evidence and ingestion; share the resulting data contract and
unresolved gaps with Harfi. No symbol or end date has been selected. Complete this
gate before a full backfill or production scorer.

- [ ] Agree one symbol and exchange trading date, API access/budget, and fixed
  market scope. Record market/board/session inclusion, timezone and date boundaries.
- [ ] Obtain and archive daily broker observations, with endpoint, exact query
  scope (no secrets), retrieval time, status, and unchanged response body. Use a
  daily endpoint, not date-range totals. Record pagination/caps and prove every
  required page was exhausted without hidden truncation.
- [ ] Demonstrate unique `symbol × trade_date × broker_code` rows. Distinguish
  confirmed zero activity from missing/unavailable observations. Establish how
  holidays, suspensions, late arrivals, and revised data are represented.
- [ ] Verify consistent buy/sell units, currency, value scaling, and whether volumes
  mean shares or lots. Require nonnegative gross values and check each row's supplied
  net against `buy_value - sell_value`. Record precision and rounding conventions.
- [ ] Establish the appropriate full active broker universe from provider evidence
  and independent controls where available. Include institutional, retail, mixed,
  and unknown intermediaries. Flag unmatched registry codes and missing historical
  classifications without dropping their trades. Registry membership shares do not
  prove trading coverage; inactivity cannot be inferred from an unexplained omission.
- [ ] Reconcile total buys and total sells and total net flow against zero, then
  compare both gross sides to a trusted stock-day turnover/control total in exactly
  the same scope. Resolve one-sided versus two-sided turnover definitions. Document
  any rounding tolerance and its justification; balanced incomplete subsets can
  still pass a zero-sum check, so reconciliation alone is insufficient.
- [ ] Save a concise evidence report listing checks, counts, discrepancies, missing
  brokers/dates, source lineage, and unresolved gaps. Agree coverage acceptance and
  classification-history treatment before marking the day complete. Do not extend
  one day's result into a claim about availability of 65 dates or ten symbols.

A top-N buyer/seller response is not a complete broker universe. Do not infer all
net-selling magnitudes or the institutional activity denominator from rankings.
The [documented per-symbol daily endpoint](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-summary-by-symbol)
is a candidate source for this experiment, but its description does not replace
the checks above. Once the one-day evidence passes, implement the validated daily
input contract and only then plan a quota-aware historical ingestion milestone.
