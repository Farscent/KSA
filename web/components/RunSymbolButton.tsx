"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { runAnalystStream } from "@/lib/agent/streamClient";
import type { StepEvent } from "@/lib/agent/pipeline";

/**
 * Runs the analyst for this one stock, so a holding the portfolio pass has not
 * reached (or a stock opened on its own) doesn't send the user back to the
 * dashboard. Saved without a portfolio run id, so it never appears as a
 * portfolio run in History. A repeat costs 0 Sectors credits (cache-first).
 */
export function RunSymbolButton({ symbol, hasRun }: { symbol: string; hasRun: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<StepEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const result = await runAnalystStream(symbol, (event) => {
      if (event.type === "step") setStep(event);
    });
    setRunning(false);
    setStep(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={running}
        className="cursor-pointer rounded-md px-3.5 py-2.5 font-medium text-xs text-white disabled:cursor-wait disabled:opacity-70"
        style={{ background: "var(--color-accent)" }}
      >
        {running ? "Researching…" : hasRun ? `Re-run Analyst on ${symbol}` : `Run Analyst on ${symbol}`}
      </button>
      {running && step && (
        <span className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          {step.label}
        </span>
      )}
      {error && (
        <span className="font-mono text-[11px]" style={{ color: "var(--color-accent)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
