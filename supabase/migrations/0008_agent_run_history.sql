-- Let agent_runs accumulate history instead of overwriting per (user, symbol, trade_date).
--
-- Previously a second Run Analyst pass on the same symbol/day upserted over the first,
-- so there was no way to look back at an earlier run. portfolio_runs already had no such
-- constraint and was already insert-only; this brings agent_runs in line so both per-symbol
-- reports and portfolio summaries keep every past run.

alter table public.agent_runs
  drop constraint if exists agent_runs_user_id_symbol_trade_date_key;

create index if not exists agent_runs_user_symbol_created_idx
  on public.agent_runs (user_id, symbol, created_at desc);

comment on column public.agent_runs.trade_date is
  'The trade date this run was computed against. No longer part of the row identity — a symbol can now have multiple rows on the same trade_date, one per Run Analyst pass.';
