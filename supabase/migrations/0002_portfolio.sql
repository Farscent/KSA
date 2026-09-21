-- User-entered portfolio data: holdings and recorded intent.
--
-- Written by the Next.js app as the signed-in user. Every row is scoped to
-- auth.uid() and protected by RLS — the app never passes a user_id from the
-- client, it relies on the column default and the policies below.

-- holdings -------------------------------------------------------------------
create table if not exists public.holdings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The FK is what restricts entry to the frozen demo universe: a symbol with
  -- no serve_position row cannot be held, so no holding can ever lack
  -- reference data.
  symbol     text not null references public.serve_position (symbol) on delete restrict,
  lots       integer not null check (lots > 0),
  -- Average cost per SHARE in whole IDR (1 lot = 100 shares).
  avg_price  bigint not null check (avg_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create index if not exists holdings_user_id_idx on public.holdings (user_id);

comment on table public.holdings is
  'User-entered positions. Decision support only — never an order or a broker connection.';
comment on column public.holdings.avg_price is
  'Average cost per share in whole IDR. Multiply by lots * 100 for cost basis.';

-- Holding cap ----------------------------------------------------------------
-- Mirrors HOLDINGS_CAP in web/lib/holdings/store.tsx. Enforced here so the cap
-- is a real constraint rather than a client-side courtesy.
create or replace function public.enforce_holdings_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held integer;
begin
  select count(*) into held from public.holdings where user_id = new.user_id;
  if held >= 15 then
    raise exception 'HOLDINGS_CAP_REACHED: a portfolio may hold at most 15 positions'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger holdings_cap_before_insert
  before insert on public.holdings
  for each row execute function public.enforce_holdings_cap();

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger holdings_touch_updated_at
  before update on public.holdings
  for each row execute function public.touch_updated_at();

-- Both functions fire as part of the table's own write path and are never
-- called directly. Without this revoke they are exposed as callable RPCs at
-- /rest/v1/rpc/<name>, which the database linter flags.
revoke execute on function public.enforce_holdings_cap() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- intents --------------------------------------------------------------------
-- Hold / Watch / Plan swap record the user's stated intent ONLY. Nothing here
-- places, schedules, or represents an order (CLAUDE.md compliance rules).
create table if not exists public.intents (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null references public.serve_position (symbol) on delete cascade,
  action      text not null check (action in ('Hold', 'Watch', 'Plan swap')),
  recorded_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

comment on table public.intents is
  'Records user intent only — never an order, never sent to a broker.';

-- Row level security ---------------------------------------------------------
alter table public.holdings enable row level security;
alter table public.intents  enable row level security;

create policy "holdings selectable by owner"
  on public.holdings for select to authenticated using (auth.uid() = user_id);
create policy "holdings insertable by owner"
  on public.holdings for insert to authenticated with check (auth.uid() = user_id);
create policy "holdings updatable by owner"
  on public.holdings for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "holdings deletable by owner"
  on public.holdings for delete to authenticated using (auth.uid() = user_id);

create policy "intents selectable by owner"
  on public.intents for select to authenticated using (auth.uid() = user_id);
create policy "intents insertable by owner"
  on public.intents for insert to authenticated with check (auth.uid() = user_id);
create policy "intents updatable by owner"
  on public.intents for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "intents deletable by owner"
  on public.intents for delete to authenticated using (auth.uid() = user_id);
