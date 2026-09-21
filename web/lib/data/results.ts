/**
 * Server-only reads of the Supabase results tables.
 *
 * This is the other half of the seam `lib/data/source.ts` describes: outputs
 * the Python batch actually produces are read from here, and the ones it does
 * not produce yet stay on fixtures there. Rows come back validated by the same
 * contract guards the fixtures are held to, so a batch that writes something
 * the contract forbids fails here rather than rendering a wrong number.
 *
 * Per AGENTS.md this module is reads-only, and never calls the Sectors API —
 * every external request happens in the scheduled Python batch.
 *
 * Server-only: `lib/supabase/server.ts` reads `next/headers`, which cannot
 * resolve in a client component, so importing this from one fails at build.
 */
import { createClient } from "@/lib/supabase/server";
import { assertPosition, assertPriceHistory, ContractViolation } from "@/lib/contract/guards";
import type {
  PricePoint,
  ServePositionRecord,
  ServePriceHistoryRecord,
  ServeRunRecord,
} from "@/lib/contract/types";

/** A row of serve_price_history as stored: one symbol-date, not a nested series. */
interface PriceHistoryRow {
  symbol: string;
  trade_date: string;
  close: number;
  volume: number | null;
}

/**
 * serve_run as stored. The contract's nested `window` object is flattened into
 * three columns (see docs/results-schema.md) because Postgres has no natural
 * nested-object column and `window` is a reserved word.
 */
interface RunRow {
  data_date: string;
  trade_date: string;
  window_sessions: number;
  window_start: string;
  window_end: string;
  symbols_requested: number;
  symbols_matched: number;
  cohorts_unavailable: number;
}

export async function fetchPositions(): Promise<ServePositionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_position")
    .select("symbol, name, sector, close, close_date, currency, value_status, reason_codes")
    .order("symbol");

  if (error) throw new Error(`serve_position read failed: ${error.message}`);

  const records = (data ?? []) as ServePositionRecord[];
  records.forEach(assertPosition);
  return records;
}

/**
 * Groups the stored symbol-date rows back into the contract's nested shape.
 *
 * A symbol with no rows at all is returned UNAVAILABLE rather than omitted, so
 * callers can tell "no price history" apart from "symbol not in the universe" —
 * the same distinction serve_position draws with PRICE_NOT_YET_INGESTED.
 */
export async function fetchPriceHistory(symbols: string[]): Promise<ServePriceHistoryRecord[]> {
  if (symbols.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_price_history")
    .select("symbol, trade_date, close, volume")
    .in("symbol", symbols)
    .order("trade_date");

  if (error) throw new Error(`serve_price_history read failed: ${error.message}`);

  const bySymbol = new Map<string, PricePoint[]>(symbols.map((symbol) => [symbol, []]));
  for (const row of (data ?? []) as PriceHistoryRow[]) {
    bySymbol.get(row.symbol)?.push({
      trade_date: row.trade_date,
      close: row.close,
      volume: row.volume,
    });
  }

  const records = Array.from(bySymbol.entries()).map(([symbol, points]) => ({
    symbol,
    points,
    currency: "IDR" as const,
    value_status: points.length > 0 ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
    reason_codes: points.length > 0 ? [] : ["PRICE_NOT_YET_INGESTED"],
  }));
  records.forEach(assertPriceHistory);
  return records;
}

/**
 * The most recent batch run, or null before the first one has landed. Every
 * screen showing computed data must display this provenance, so a null here is
 * rendered as an explicit "no run yet" rather than silently omitted.
 */
export async function fetchRun(): Promise<ServeRunRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_run")
    .select(
      "data_date, trade_date, window_sessions, window_start, window_end, " +
        "symbols_requested, symbols_matched, cohorts_unavailable"
    )
    .order("data_date", { ascending: false })
    .limit(1)
    .returns<RunRow[]>();

  if (error) throw new Error(`serve_run read failed: ${error.message}`);

  const row = data?.[0];
  if (!row) return null;
  if (row.window_sessions <= 0) {
    throw new ContractViolation("serve_run window_sessions must be positive");
  }
  if (row.symbols_matched > row.symbols_requested) {
    throw new ContractViolation("serve_run symbols_matched cannot exceed symbols_requested");
  }
  return {
    data_date: row.data_date,
    trade_date: row.trade_date,
    window: {
      sessions: row.window_sessions,
      start: row.window_start,
      end: row.window_end,
    },
    symbols_requested: row.symbols_requested,
    symbols_matched: row.symbols_matched,
    cohorts_unavailable: row.cohorts_unavailable,
  };
}
