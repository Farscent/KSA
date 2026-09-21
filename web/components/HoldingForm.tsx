"use client";

import { useState } from "react";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { CapMeter } from "@/components/CapMeter";
import { Toast } from "@/components/Toast";
import { useHoldings, HOLDINGS_CAP, SHARES_PER_LOT, type Holding } from "@/lib/holdings/store";
import { useResults } from "@/lib/data/ResultsProvider";
import { idr } from "@/lib/format";

interface FormState {
  query: string;
  pickedSym: string | null;
  lots: string;
  avg: string;
  /** The symbol being edited, or null when adding. Holdings are keyed by
   *  symbol in the database, so an index would go stale on a refresh. */
  editingSym: string | null;
}

const EMPTY_FORM: FormState = { query: "", pickedSym: null, lots: "", avg: "", editingSym: null };

export function HoldingForm() {
  const { holdings, addHolding, updateHolding, deleteHolding, atCap, pending } = useHoldings();
  const { positionOf } = useResults();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);

  const isEditing = form.editingSym !== null;
  const blockedByCap = !isEditing && atCap;
  const canSubmit =
    Boolean(form.pickedSym) && Boolean(form.lots) && Boolean(form.avg) && !pending && !blockedByCap;
  const excludeSymbols = new Set(
    holdings.filter((h) => h.sym !== form.editingSym).map((h) => h.sym)
  );

  // Entry-time sanity checks against the batch's own close. This is a typo
  // guard on what the user says they paid — not a valuation opinion, and never
  // a reason to refuse the entry. `canSubmit` above deliberately ignores it.
  const picked = form.pickedSym ? positionOf(form.pickedSym) : undefined;
  const referenceClose =
    picked && picked.value_status === "AVAILABLE" ? picked.close : null;
  const lotsEntered = parseInt(form.lots, 10) || 0;
  const avgEntered = parseInt(form.avg, 10) || 0;
  const costPreview = lotsEntered > 0 && avgEntered > 0 ? lotsEntered * SHARES_PER_LOT * avgEntered : null;
  // Order-of-magnitude only: a genuine multi-bagger or a deep loss stays quiet.
  const closeMultiple = referenceClose && avgEntered > 0 ? avgEntered / referenceClose : null;
  const priceLooksOff = closeMultiple !== null && (closeMultiple > 10 || closeMultiple < 0.1);

  // A rejected write must say why. Silently leaving the row unchanged reads as
  // a broken button, which is how the previous local-only store behaved.
  function announce(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? null : current)), 4000);
  }

  function onQueryChange(query: string) {
    setForm((f) => ({ ...f, query, pickedSym: null }));
  }

  function onPick(symbol: string) {
    setForm((f) => ({ ...f, query: symbol, pickedSym: symbol }));
  }

  async function onSubmit() {
    if (!canSubmit || !form.pickedSym) return;
    const lots = parseInt(form.lots, 10);
    const avg = parseInt(form.avg, 10);
    if (!lots || !avg) return;
    const holding: Holding = { sym: form.pickedSym, lots, avg };
    const result =
      form.editingSym === null
        ? await addHolding(holding)
        : await updateHolding(form.editingSym, holding);
    if (!result.ok) {
      announce(result.error ?? "Could not save that holding.");
      return;
    }
    announce(form.editingSym === null ? `Added ${holding.sym}` : `Saved ${holding.sym}`);
    setForm(EMPTY_FORM);
  }

  async function onDelete(symbol: string) {
    const result = await deleteHolding(symbol);
    announce(result.ok ? `Removed ${symbol}` : result.error ?? "Could not remove that holding.");
  }

  function onEdit(symbol: string) {
    const h = holdings.find((row) => row.sym === symbol);
    if (!h) return;
    setForm({ query: h.sym, pickedSym: h.sym, lots: String(h.lots), avg: String(h.avg), editingSym: h.sym });
  }

  return (
    <div className="relative grid gap-7 p-7" style={{ gridTemplateColumns: "452px 1fr" }}>
      <div className="rounded-lg border bg-[var(--color-card)] p-5.5" style={{ borderColor: "var(--color-line)" }}>
        <div className="font-medium text-sm text-[var(--color-ink)]">
          {isEditing ? "Edit holding" : "Add a holding"}
        </div>
        <div className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
          Positions are reviewed for structural change in broker trading behaviour. Nothing here is an order.
        </div>

        <div
          className="mt-5 font-mono text-[10.5px] font-medium uppercase text-[var(--color-muted)]"
          style={{ letterSpacing: "0.09em" }}
        >
          Stock symbol
        </div>
        <SymbolAutocomplete
          value={form.query}
          onQueryChange={onQueryChange}
          onPick={onPick}
          excludeSymbols={excludeSymbols}
          isPicked={Boolean(form.pickedSym)}
        />

        <div className="mt-4 grid grid-cols-2 gap-3.5">
          <div>
            <div
              className="font-mono text-[10.5px] font-medium uppercase text-[var(--color-muted)]"
              style={{ letterSpacing: "0.09em" }}
            >
              Lots
            </div>
            <input
              value={form.lots}
              onChange={(e) => setForm((f) => ({ ...f, lots: e.target.value.replace(/[^0-9]/g, "") }))}
              placeholder="0"
              className="mt-1.5 w-full box-border rounded-md border px-2.5 py-2 font-mono text-[13px] text-[var(--color-ink)] bg-[var(--color-card)]"
              style={{ borderColor: "var(--color-input-border)" }}
            />
            <div className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--color-muted-2)" }}>
              {form.lots ? `= ${(parseInt(form.lots, 10) * SHARES_PER_LOT).toLocaleString("id-ID")} shares` : "1 lot = 100 shares"}
            </div>
          </div>
          <div>
            <div
              className="font-mono text-[10.5px] font-medium uppercase text-[var(--color-muted)]"
              style={{ letterSpacing: "0.09em" }}
            >
              Average price
            </div>
            <div
              className="mt-1.5 flex items-center rounded-md border bg-[var(--color-card)]"
              style={{ borderColor: "var(--color-input-border)" }}
            >
              <span className="py-2 pl-2.5 font-mono text-xs" style={{ color: "var(--color-muted-2)" }}>
                Rp
              </span>
              <input
                value={form.avg}
                onChange={(e) => setForm((f) => ({ ...f, avg: e.target.value.replace(/[^0-9]/g, "") }))}
                placeholder="0"
                className="w-full box-border border-none py-2 pl-1.5 pr-2.5 font-mono text-[13px] text-[var(--color-ink)]"
              />
            </div>
            <div className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--color-muted-2)" }}>
              {referenceClose !== null
                ? `per share · ${form.pickedSym} closed ${idr(referenceClose)}`
                : "per share"}
            </div>
          </div>
        </div>

        {/* Seeing the cost basis form while typing is what makes a misplaced
            zero obvious before it is saved and shows up as a -99% row. */}
        {costPreview !== null && (
          <div
            className="mt-3 flex justify-between gap-3 rounded-md px-3 py-2 font-mono text-[11px]"
            style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
          >
            <span>
              {lotsEntered.toLocaleString("id-ID")} lots {"×"} {SHARES_PER_LOT} {"×"} {idr(avgEntered)}
            </span>
            <span className="font-medium text-[var(--color-ink)]">{idr(costPreview)}</span>
          </div>
        )}

        {priceLooksOff && closeMultiple !== null && referenceClose !== null && (
          <div
            className="mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
            style={{
              background: "var(--color-warn-bg)",
              borderColor: "var(--color-warn-border)",
              color: "var(--color-warn)",
            }}
          >
            That is{" "}
            <span className="font-mono font-medium">
              {closeMultiple > 1
                ? `${closeMultiple.toLocaleString("id-ID", { maximumFractionDigits: 1 })}×`
                : `1/${(1 / closeMultiple).toLocaleString("id-ID", { maximumFractionDigits: 1 })} of`}
            </span>{" "}
            {form.pickedSym}&apos;s last close of {idr(referenceClose)} per share.{" "}
            {closeMultiple > 1
              ? "Did you mean the total you paid, rather than the price per share?"
              : "Check the figure is per share, not per lot."}{" "}
            You can save it either way {"—"} this is only a check against the last ingested close.
          </div>
        )}

        <div className="mt-5 flex items-center gap-2.5">
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="rounded-md px-4.5 py-2.5 font-medium text-[12.5px]"
            style={{
              cursor: canSubmit ? "pointer" : "default",
              background: canSubmit ? "var(--color-accent)" : "#c7cdd3",
              color: "#fff",
            }}
          >
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add holding"}
          </button>
          {isEditing && (
            <button
              onClick={() => setForm(EMPTY_FORM)}
              className="rounded-md border px-4 py-2.5 font-normal text-[12.5px] bg-[var(--color-card)]"
              style={{ borderColor: "var(--color-input-border)", color: "#3d4650" }}
            >
              Cancel
            </button>
          )}
          <div className="ml-auto font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
            {holdings.length} / {HOLDINGS_CAP} used
          </div>
        </div>
      </div>

      <div>
        <CapMeter count={holdings.length} />

        <div className="mt-4 overflow-hidden rounded-lg border bg-[var(--color-card)]" style={{ borderColor: "var(--color-line)" }}>
          <div
            className="grid gap-3 px-4.5 py-2.5 font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
            style={{
              gridTemplateColumns: "104px 1fr 72px 124px 148px 96px",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-line-strong)",
              letterSpacing: "0.09em",
            }}
          >
            <div>Symbol</div>
            <div>Company</div>
            <div className="text-right">Lots</div>
            <div className="text-right">Avg price</div>
            <div className="text-right">Cost basis</div>
            <div />
          </div>
          {holdings.length === 0 && (
            <div className="px-4.5 py-5.5 text-center text-xs" style={{ color: "var(--color-muted-2)" }}>
              No holdings yet {"—"} add your first position.
            </div>
          )}
          {holdings.map((h, i) => {
            const cost = h.lots * SHARES_PER_LOT * h.avg;
            return (
              <div
                key={`${h.sym}-${i}`}
                className="grid items-center gap-3 px-4.5 py-3 border-b"
                style={{ gridTemplateColumns: "104px 1fr 72px 124px 148px 96px", borderColor: "var(--color-line-soft)" }}
              >
                <div className="font-mono text-[12.5px] font-medium text-[var(--color-ink)]">{h.sym}</div>
                <div className="text-[12.5px]" style={{ color: "#3d4650" }}>
                  {positionOf(h.sym)?.name ?? h.sym}
                </div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{h.lots}</div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{idr(h.avg)}</div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{idr(cost)}</div>
                <div className="flex justify-end gap-3.5 text-[11.5px]" style={{ color: "var(--color-accent)" }}>
                  <button onClick={() => onEdit(h.sym)} className="cursor-pointer">
                    Edit
                  </button>
                  <button onClick={() => onDelete(h.sym)} className="cursor-pointer" style={{ color: "#8a939e" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="mt-3.5 flex items-start gap-2.5 rounded-lg border p-3.5"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
        >
          <span
            className="pt-px font-mono text-[10px] font-medium uppercase text-[var(--color-muted)]"
            style={{ letterSpacing: "0.08em" }}
          >
            Note
          </span>
          <span className="max-w-[620px] text-[11.5px] leading-relaxed" style={{ color: "#4a535e" }}>
            Holdings are used only to select which symbols get reviewed. Sectors Review does not connect to a
            broker account, does not place orders, and does not forecast prices.
          </span>
        </div>
      </div>
      <Toast message={message} />
    </div>
  );
}
