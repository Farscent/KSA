"use server";

/**
 * Mutations on the signed-in user's own portfolio rows.
 *
 * No action takes or trusts a user id. `holdings.user_id` and `intents.user_id`
 * default to `auth.uid()` in the database, and row level security scopes every
 * update and delete to the owner, so authorization is enforced by Postgres
 * rather than by argument passing.
 *
 * Every action returns a result object instead of throwing, so the UI can show
 * the real reason a write was refused — a silently ignored click reads as a
 * broken button.
 */
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Holding, IntentAction } from "@/lib/holdings/store";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const OK: ActionResult = { ok: true };

/** Turn a Postgres failure into something a person can act on. */
function explain(message: string, code?: string): string {
  if (message.includes("HOLDINGS_CAP_REACHED")) {
    return "Portfolio is full — remove a holding before adding another.";
  }
  if (code === "23505") return "That symbol is already in your portfolio.";
  if (code === "23503") return "That symbol is not in the reviewed demo universe.";
  if (code === "23514") return "Lots and average price must both be greater than zero.";
  if (code === "42501") return "You are not signed in.";
  return message;
}

function validate(holding: Holding): string | null {
  if (!holding.sym) return "Pick a stock symbol first.";
  if (!Number.isInteger(holding.lots) || holding.lots <= 0) return "Lots must be a whole number above zero.";
  if (!Number.isInteger(holding.avg) || holding.avg <= 0) return "Average price must be a whole number above zero.";
  return null;
}

export async function addHolding(holding: Holding): Promise<ActionResult> {
  const invalid = validate(holding);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from("holdings")
    .insert({ symbol: holding.sym, lots: holding.lots, avg_price: holding.avg });

  if (error) return { ok: false, error: explain(error.message, error.code) };
  revalidatePath("/", "layout");
  return OK;
}

export async function updateHolding(symbol: string, holding: Holding): Promise<ActionResult> {
  const invalid = validate(holding);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  // Editing the symbol itself is an add plus a delete, not an update — doing it
  // in one statement would silently skip the cap and duplicate checks.
  if (holding.sym !== symbol) {
    const added = await addHolding(holding);
    if (!added.ok) return added;
    return deleteHolding(symbol);
  }

  const { error } = await supabase
    .from("holdings")
    .update({ lots: holding.lots, avg_price: holding.avg })
    .eq("symbol", symbol);

  if (error) return { ok: false, error: explain(error.message, error.code) };
  revalidatePath("/", "layout");
  return OK;
}

export async function deleteHolding(symbol: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("holdings").delete().eq("symbol", symbol);

  if (error) return { ok: false, error: explain(error.message, error.code) };
  revalidatePath("/", "layout");
  return OK;
}

/**
 * Records the user's stated intent. This is not an order: nothing here reaches
 * a broker, schedules a trade, or changes a holding.
 */
export async function recordIntent(symbol: string, action: IntentAction): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("intents")
    .upsert({ symbol, action, recorded_at: new Date().toISOString() }, { onConflict: "user_id,symbol" });

  if (error) return { ok: false, error: explain(error.message, error.code) };
  revalidatePath("/", "layout");
  return OK;
}
