/**
 * Server-only reads of the signed-in user's own portfolio rows.
 *
 * Neither function passes a user id: row level security scopes every query to
 * `auth.uid()`, so a missing or wrong filter here cannot leak another user's
 * holdings. See supabase/migrations/0002_portfolio.sql.
 */
import { createClient } from "@/lib/supabase/server";
import type { Holding, Intent } from "@/lib/holdings/store";

interface HoldingRow {
  symbol: string;
  lots: number;
  avg_price: number;
}

interface IntentRow {
  symbol: string;
  action: Intent["action"];
  recorded_at: string;
}

export async function fetchHoldings(): Promise<Holding[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holdings")
    .select("symbol, lots, avg_price")
    .order("created_at");

  if (error) throw new Error(`holdings read failed: ${error.message}`);

  // `avg_price` is the column; `avg` is the frontend's field name. The mapping
  // lives here and nowhere else (docs/results-schema.md).
  return ((data ?? []) as HoldingRow[]).map((row) => ({
    sym: row.symbol,
    lots: row.lots,
    avg: row.avg_price,
  }));
}

export async function fetchIntents(): Promise<Record<string, Intent>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("intents").select("symbol, action, recorded_at");

  if (error) throw new Error(`intents read failed: ${error.message}`);

  const intents: Record<string, Intent> = {};
  for (const row of (data ?? []) as IntentRow[]) {
    intents[row.symbol] = { action: row.action, date: row.recorded_at.slice(0, 10) };
  }
  return intents;
}
