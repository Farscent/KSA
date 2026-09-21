"use client";

import { useState } from "react";
import { answerFor } from "@/lib/ask/answer";
import type { Totals } from "@/lib/portfolio";

interface AskPanelProps {
  totals: Totals;
  flaggedSymbols: string[];
}

interface ThreadItem {
  q: string;
  a: string;
}

export function AskPanel({ totals, flaggedSymbols }: AskPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<ThreadItem[]>([]);

  function submit(question: string) {
    const q = question.trim();
    if (!q) return;
    const a = answerFor(q, totals, flaggedSymbols);
    setThread((t) => [...t, { q, a }]);
    setInput("");
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 font-medium text-[11.5px]"
        style={{ color: "var(--color-accent)" }}
      >
        {open ? "− Hide questions about this result" : "+ Ask a question about this result"}
      </button>

      {open && (
        <div className="mt-4 rounded-lg border p-4" style={{ borderColor: "var(--color-line)", background: "#faf9f7" }}>
          <div
            className="font-mono text-[11px] font-medium uppercase text-[var(--color-muted)]"
            style={{ letterSpacing: "0.07em" }}
          >
            Ask about this result
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted-2)" }}>
            Answers only reference figures shown on this page {"—"} never new data or advice.
          </div>

          {thread.length > 0 && (
            <div className="mt-3.5 flex flex-col gap-3">
              {thread.map((t, i) => (
                <div key={i}>
                  <div className="font-medium text-xs text-[var(--color-ink)]">{t.q}</div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: "#4a535e" }}>
                    {t.a}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap gap-2">
            {["Why is a holding flagged?", "What does coverage mean?", "How is unrealized P&L calculated?"].map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="cursor-pointer rounded-full border bg-[var(--color-card)] px-2.5 py-1.5 text-[11px]"
                style={{ borderColor: "var(--color-line)", color: "#4a535e" }}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(input)}
              placeholder="Ask a question about this result…"
              className="flex-1 box-border rounded-md border px-2.5 py-2 text-[12.5px] text-[var(--color-ink)] bg-[var(--color-card)]"
              style={{ borderColor: "var(--color-input-border)" }}
            />
            <button
              onClick={() => submit(input)}
              className="cursor-pointer rounded-md px-4 py-2 font-medium text-xs text-white"
              style={{ background: "var(--color-accent)" }}
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
