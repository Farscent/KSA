-- Link each per-symbol Run Analyst report to the portfolio run that produced it.
--
-- Until now the History pickers matched agent_runs to portfolio_runs by timestamp
-- only, so a past portfolio summary could not be shown next to the reports it was
-- built from. A Run Analyst pass now generates one run id up front; every
-- agent_runs row it writes carries it, and the portfolio_runs row it ends with
-- uses it as its own primary key.
--
-- No foreign key on purpose: the per-symbol rows are written before the portfolio
-- row exists, and a run that fails before the summary leaves per-symbol rows with
-- no portfolio row (single-symbol runs from a stock page also have none).

alter table public.agent_runs
  add column if not exists run_id uuid;

create index if not exists agent_runs_user_run_idx
  on public.agent_runs (user_id, run_id);

comment on column public.agent_runs.run_id is
  'The portfolio_runs.id of the Run Analyst pass that produced this report. Null for single-symbol runs and for rows saved before this column existed that no portfolio run matches.';

-- Backfill: attach each existing report to the first portfolio run of the same user
-- that covers its symbol and was saved within 30 minutes after it. Anything with no
-- such run stays null rather than being linked to an unrelated one.
update public.agent_runs a
set run_id = (
  select p.id
  from public.portfolio_runs p
  where p.user_id = a.user_id
    and a.symbol = any (p.symbols)
    and p.created_at >= a.created_at
    and p.created_at <= a.created_at + interval '30 minutes'
  order by p.created_at asc
  limit 1
)
where a.run_id is null;
