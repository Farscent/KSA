"use client";

import { useState } from "react";
import { askFollowUp } from "@/lib/agent/actions";

interface ThreadItem {
  q: string;
  a: string;
}

/**
 * Follow-up chat about one symbol's saved Run Analyst report. Every answer is
 * grounded in the same package the report itself was built from (lib/llm/
 * package.ts) — never new data, matching the Ask panel's existing rule that an
 * answer must never state a figure the report didn't already show.
 */
export function AnalystChat({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    setPending(true);
    setError(null);
    const result = await askFollowUp(
      symbol,
      q,
      thread.map(({ q, a }) => ({ q, a }))
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setThread((t) => [...t, { q, a: result.answer }]);
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 font-medium text-[11.5px]"
        style={{ color: "var(--color-accent)" }}
      >
        {open ? "− Hide questions about this report" : "+ Ask the analyst about this report"}
      </button>

      {open && (
        <div className="mt-4 rounded-lg border p-4" style={{ borderColor: "var(--color-line)", background: "#faf9f7" }}>
          <div
            className="font-mono text-[11px] font-medium uppercase text-[var(--color-muted)]"
            style={{ letterSpacing: "0.07em" }}
          >
            Ask the analyst
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted-2)" }}>
            Answers only reference figures from this report {"—"} never new data or advice.
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

          {pending && (
            <div className="mt-3.5 text-xs" style={{ color: "var(--color-muted)" }}>
              Thinking{"…"}
            </div>
          )}
          {error && (
            <div className="mt-3.5 text-xs" style={{ color: "var(--color-accent)" }}>
              {error}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(input)}
              placeholder="Ask a question about this report…"
              disabled={pending}
              className="flex-1 box-border rounded-md border px-2.5 py-2 text-[12.5px] text-[var(--color-ink)] bg-[var(--color-card)]"
              style={{ borderColor: "var(--color-input-border)" }}
            />
            <button
              onClick={() => submit(input)}
              disabled={pending}
              className="cursor-pointer rounded-md px-4 py-2 font-medium text-xs text-white disabled:opacity-50"
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
