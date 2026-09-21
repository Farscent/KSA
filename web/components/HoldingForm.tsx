"use client";

import { useState } from "react";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { CapMeter } from "@/components/CapMeter";
import { useHoldings, HOLDINGS_CAP, SHARES_PER_LOT, type Holding } from "@/lib/holdings/store";
import { getPosition } from "@/lib/data/source";
import { idr } from "@/lib/format";

interface FormState {
  query: string;
  pickedSym: string | null;
  lots: string;
  avg: string;
  editingIndex: number | null;
}

const EMPTY_FORM: FormState = { query: "", pickedSym: null, lots: "", avg: "", editingIndex: null };

export function HoldingForm() {
  const { holdings, addHolding, updateHolding, deleteHolding, atCap } = useHoldings();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const isEditing = form.editingIndex !== null;
  const canSubmit = Boolean(form.pickedSym) && Boolean(form.lots) && Boolean(form.avg);
  const excludeSymbols = new Set(
    holdings.filter((_, i) => i !== form.editingIndex).map((h) => h.sym)
  );

  function onQueryChange(query: string) {
    setForm((f) => ({ ...f, query, pickedSym: null }));
  }

  function onPick(symbol: string) {
    setForm((f) => ({ ...f, query: symbol, pickedSym: symbol }));
  }

  function onSubmit() {
    if (!canSubmit || !form.pickedSym) return;
    const lots = parseInt(form.lots, 10);
    const avg = parseInt(form.avg, 10);
    if (!lots || !avg) return;
    const holding: Holding = { sym: form.pickedSym, lots, avg };
    if (form.editingIndex === null) {
      if (atCap) return;
      if (holdings.some((h) => h.sym === holding.sym)) return;
      addHolding(holding);
    } else {
      updateHolding(form.editingIndex, holding);
    }
    setForm(EMPTY_FORM);
  }

  function onEdit(index: number) {
    const h = holdings[index];
    setForm({ query: h.sym, pickedSym: h.sym, lots: String(h.lots), avg: String(h.avg), editingIndex: index });
  }

  return (
    <div className="grid gap-7 p-7" style={{ gridTemplateColumns: "452px 1fr" }}>
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
              per share
            </div>
          </div>
        </div>

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
            {isEditing ? "Save changes" : "Add holding"}
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
                  {getPosition(h.sym)?.name ?? h.sym}
                </div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{h.lots}</div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{idr(h.avg)}</div>
                <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--color-ink)]">{idr(cost)}</div>
                <div className="flex justify-end gap-3.5 text-[11.5px]" style={{ color: "var(--color-accent)" }}>
                  <button onClick={() => onEdit(i)} className="cursor-pointer">
                    Edit
                  </button>
                  <button onClick={() => deleteHolding(i)} className="cursor-pointer" style={{ color: "#8a939e" }}>
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
    </div>
  );
}
