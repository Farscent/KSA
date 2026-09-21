# Results schema — the Python ↔ Next.js boundary

`CLAUDE.md` locks this: *"Results-table schema/column names — write as a committed
schema file before either side builds against it."* This document and the two
migrations it points at are that file.

- `supabase/migrations/0001_results.sql` — batch-written results.
- `supabase/migrations/0002_portfolio.sql` — user-entered portfolio data.

Project: `tlxgfcoceabymreadbhi`.

## Who writes what

Per `AGENTS.md`'s ownership split, the two sides never share a table they both write.

| Table | Written by | Read by | Auth |
| --- | --- | --- | --- |
| `serve_position` | Python batch | app | service-role write, `authenticated` select |
| `serve_price_history` | Python batch | app | service-role write, `authenticated` select |
| `serve_run` | Python batch | app | service-role write, `authenticated` select |
| `holdings` | app (as the user) | app | RLS on `auth.uid()` |
| `intents` | app (as the user) | app | RLS on `auth.uid()` |

The three `serve_*` tables have **no** INSERT/UPDATE/DELETE policy at all. That is
deliberate: the batch writes with the service-role key, which bypasses RLS, so the
app physically cannot mutate results even if a bug tried to. Read access is
`authenticated` only — an anonymous visitor sees nothing, which matches the app's
login-required routing in `web/proxy.ts`.

> The service-role key bypasses RLS and must never appear under `web/`, in
> `NEXT_PUBLIC_*`, or in any file served to a browser. It belongs in the Python
> batch's environment only.

## Column naming

Columns mirror the `serve_*` output contract field-for-field
(`docs/serve-contract-1.1.md`, `docs/serve-contract-1.2.md`). Renaming one here
silently breaks the frontend's contract guards, which assert against the
documented field names. Two documented deviations:

- `serve_run`'s nested `window {sessions, start, end}` is flattened to
  `window_sessions` / `window_start` / `window_end`. Postgres has no natural
  nested-object column, and `window` is a reserved word.
- `holdings.avg_price` is the frontend's `Holding.avg`. The frontend's field name
  is an abbreviation that reads ambiguously as a column; the mapping happens in
  one place, at the app's data layer.

## Invariants enforced in the database

These are not merely conventions — a bad batch run fails at the write rather than
showing a wrong number on screen.

- `serve_position`: `value_status = 'AVAILABLE'` **iff** `close` and `close_date`
  are both present, **iff** `reason_codes` is empty. An unavailable price cannot
  be stored as `0`, and an available one cannot lose its date.
- `serve_price_history.symbol` references `serve_position(symbol)`, so history can
  never exist for a symbol with no reference data.
- `holdings.symbol` references `serve_position(symbol)`. This is what restricts
  holdings to the frozen ten-symbol demo universe, and it is a stronger guarantee
  than the client-side check it replaces: every holding is guaranteed to have a
  name, sector, and price row.
- `holdings` is capped at 15 rows per user by a `BEFORE INSERT` trigger, mirroring
  `HOLDINGS_CAP` in `web/lib/holdings/store.tsx`.
- `intents.action` is constrained to `Hold` / `Watch` / `Plan swap`. These record
  stated intent only — never an order, never a broker instruction.

## Changing this schema

A change here is cross-cutting by definition: it is the only thing the two sides
share. Update this document and the migration together, add a new numbered
migration rather than editing an applied one, and flag it to the other owner —
do not alter a table shape silently.
