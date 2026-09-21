"use client";

import { useHoldings, type IntentAction } from "@/lib/holdings/store";

interface IntentButtonsProps {
  symbol: string;
  onRecorded: (message: string) => void;
}

const ACTIONS: { action: IntentAction; note: string }[] = [
  { action: "Hold", note: "Note: no change" },
  { action: "Watch", note: "Add to watch list" },
  { action: "Plan swap", note: "Draft a note to self" },
];

export function IntentButtons({ symbol, onRecorded }: IntentButtonsProps) {
  const { intents, recordIntent } = useHoldings();
  const current = intents[symbol];

  function record(action: IntentAction) {
    recordIntent(symbol, action);
    onRecorded(`Recorded: ${action} · ${symbol} · saved to review notes`);
  }

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-7.5">
        <div>
          <div className="font-medium text-[13px] text-[var(--color-ink)]">Record your intent</div>
          <div className="mt-1.5 max-w-[560px] text-[11.5px] leading-relaxed" style={{ color: "#6a7480" }}>
            Saved to your review notes with today&apos;s date and a link back to this evidence report. Nothing is
            sent to a broker and no order is placed.
          </div>
        </div>
        <div className="flex flex-none gap-2.5">
          {ACTIONS.map(({ action, note }) => {
            const active = current?.action === action;
            return (
              <button
                key={action}
                onClick={() => record(action)}
                className="flex min-w-[128px] cursor-pointer flex-col items-start gap-1 rounded-md border bg-[var(--color-card)] px-3.5 py-2.5"
                style={{ borderColor: active ? "var(--color-accent)" : "var(--color-input-border)" }}
              >
                <span
                  className="font-medium text-[12.5px]"
                  style={{ color: action === "Plan swap" ? "var(--color-accent)" : "var(--color-ink)" }}
                >
                  {action}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "#8a939e" }}>
                  {note}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="mt-3.5 border-t pt-3 font-mono text-[11px]"
        style={{ borderColor: "var(--color-line)", color: "#8a939e" }}
      >
        {current
          ? `Last recorded intent · ${symbol} · ${current.action} · ${current.date}`
          : `No intent recorded yet for ${symbol}.`}
      </div>
    </div>
  );
}
