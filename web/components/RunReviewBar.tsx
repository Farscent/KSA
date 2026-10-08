"use client";

import { useEffect, useState } from "react";

import type { StepTrace } from "@/lib/agent/package";
import type { StepEvent } from "@/lib/agent/pipeline";

type RunState = "notRun" | "running" | "reviewRun";

export interface RunOutcome {
  symbol: string;
  ok: boolean;
  error?: string;
  steps?: StepTrace[];
  credits_used?: number;
}

interface RunReviewBarProps {
  state: RunState;
  onRun: () => void;
  holdingsCount: number;
  outcomes?: RunOutcome[];
  /** Symbol the pipeline is currently streaming steps for, if any. */
  inFlightSymbol?: string;
  /** Real step events for `inFlightSymbol`, as they arrive — "running" first,
   * then updated in place to "done"/"failed"/"skipped" once that step
   * finishes. Appears one at a time as the pipeline actually progresses. */
  liveSteps?: StepEvent[];
  /** True while the portfolio-wide summary is being written, after every holding is done. */
  summarising?: boolean;
  /** When the latest saved portfolio run was made; null if there has been none. */
  lastRunAt?: string | null;
}

const PIPELINE_STEP_COUNT = 7;

const STATUS_MARK: Record<string, string> = { done: "✓", failed: "✕", skipped: "–" };

/** Shared between the in-flight (uncollapsed) and finished (collapsed) views
 * so the two never drift apart. `pending` appends a row for the holding
 * currently being researched, showing each real step the moment it starts
 * and updating it in place once it finishes — not a static placeholder. */
function ResearchLogBody({
  outcomes,
  pending,
  summarising,
}: {
  outcomes: RunOutcome[];
  pending: { symbol: string; steps: StepEvent[] } | null;
  summarising: boolean;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {outcomes
        .filter((o) => o.steps?.length)
        .map((outcome) => (
          <div key={outcome.symbol}>
            <div className="font-mono text-[11px] text-[var(--color-ink)]">
              {outcome.symbol}
              {typeof outcome.credits_used === "number" ? ` · ${outcome.credits_used} credits` : ""}
            </div>
            <div className="mt-0.5 flex flex-col gap-0.5 pl-3 font-mono text-[10.5px]" style={{ color: "var(--color-muted)" }}>
              {outcome.steps!.map((step) => (
                <div key={step.id}>
                  {STATUS_MARK[step.status] ?? "·"} {step.label}
                  {step.detail ? ` — ${step.detail}` : ""} ({step.duration_ms}ms)
                </div>
              ))}
            </div>
          </div>
        ))}
      {summarising && (
        <div className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--color-ink)" }}>
          <span
            className="animate-spin-fast inline-block h-2.5 w-2.5 rounded-full border-2"
            style={{ borderColor: "var(--color-line)", borderTopColor: "var(--color-muted)" }}
          />
          portfolio {"·"} summarising{"…"}
        </div>
      )}
      {pending && (
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--color-ink)" }}>
            <span
              className="animate-spin-fast inline-block h-2.5 w-2.5 rounded-full border-2"
              style={{ borderColor: "var(--color-line)", borderTopColor: "var(--color-muted)" }}
            />
            {pending.symbol} {"·"} researching{"…"}
          </div>
          <div className="mt-0.5 flex flex-col gap-0.5 pl-3 font-mono text-[10.5px]" style={{ color: "var(--color-muted)" }}>
            {pending.steps.length === 0 && <div>{"…"} starting</div>}
            {pending.steps.map((step) => (
              <div key={step.id}>
                {step.status === "running" ? "…" : STATUS_MARK[step.status] ?? "·"} {step.label}
                {step.detail ? ` — ${step.detail}` : ""}
                {typeof step.duration_ms === "number" ? ` (${step.duration_ms}ms)` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RunReviewBar({ state, onRun, holdingsCount, outcomes, inFlightSymbol, liveSteps, summarising = false, lastRunAt }: RunReviewBarProps) {
  const [elapsed, setElapsed] = useState(0);

  const [prevState, setPrevState] = useState(state);
  if (prevState !== state) {
    setPrevState(state);
    if (state === "running") setElapsed(0);
  }

  useEffect(() => {
    if (state !== "running") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const failures = (outcomes ?? []).filter((o) => !o.ok);
  const hasResearchLog = (outcomes ?? []).some((o) => o.steps?.length);
  const doneCount = (outcomes ?? []).length;
  const hasPending = state === "running" && doneCount < holdingsCount;
  const pending =
    hasPending && inFlightSymbol ? { symbol: inFlightSymbol, steps: liveSteps ?? [] } : null;

  // A clean run still keeps the bar mounted so the research log stays
  // inspectable — it used to vanish here, hiding the very trace a user would
  // come looking for right after Run Analyst finishes.
  if (state === "reviewRun" && failures.length === 0 && !hasResearchLog) return null;

  // A saved run means this is a re-run, not a first one — even after a reload.
  const hasSavedRun = Boolean(lastRunAt);

  return (
    <div
      className="flex flex-col gap-3 border-b bg-[var(--color-card)] px-7 py-6.5"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="flex flex-wrap-reverse items-center justify-between gap-5">
        {state === "notRun" && (
          <>
            <button
              onClick={onRun}
              className="cursor-pointer rounded-md px-5 py-2.5 font-medium text-[12.5px] text-white"
              style={{ background: "var(--color-accent)" }}
            >
              {hasSavedRun ? "Re-run Analyst" : "Run Analyst"}
            </button>
            <div className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
              {hasSavedRun
                ? `Last reviewed ${new Date(lastRunAt as string).toLocaleString()}.`
                : `Analyst hasn't reviewed ${holdingsCount} holdings yet.`}
            </div>
          </>
        )}

        {state === "running" && (
          <>
            <div
              className="flex items-center gap-2.5 rounded-md px-5 py-2.5 font-medium text-[12.5px] text-white"
              style={{ background: "#c7cdd3" }}
            >
              <span
                className="animate-spin-fast inline-block h-3.5 w-3.5 rounded-full border-2 border-white/50"
                style={{ borderTopColor: "#fff" }}
              />
              Researching{"…"}
            </div>
            <div className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
              {PIPELINE_STEP_COUNT} research steps + report per holding {"·"} {elapsed}s elapsed
            </div>
          </>
        )}

        {state === "reviewRun" && (
          <button
            onClick={onRun}
            className="cursor-pointer rounded-md px-5 py-2.5 font-medium text-[12.5px] text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Re-run Analyst
          </button>
        )}
        {state === "reviewRun" && failures.length > 0 && (
          <div className="text-[12.5px]" style={{ color: "var(--color-ink)" }}>
            Analyst finished with {failures.length} problem{failures.length === 1 ? "" : "s"}.
          </div>
        )}
        {state === "reviewRun" && failures.length === 0 && hasResearchLog && (
          <div className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
            Analyst finished {"—"} see the research log below for what it did.
          </div>
        )}
      </div>

      {/* Every failing symbol, not just the first. */}
      {state === "reviewRun" && failures.length > 0 && (
        <div className="flex flex-col gap-1 font-mono text-[11px]">
          {failures.map((failure) => (
            <div key={failure.symbol} style={{ color: "var(--color-accent)" }}>
              {failure.symbol}: {failure.error}
            </div>
          ))}
        </div>
      )}

      {/* Same log content either way. While running it's rendered open — a
          collapsed toggle would defeat the point of showing the agent is
          still working. Once the run finishes it collapses behind a summary,
          same as before. */}
      {(hasResearchLog || hasPending || summarising) && (state === "running" ? (
        <div>
          <div className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
            Research log
          </div>
          <ResearchLogBody outcomes={outcomes ?? []} pending={pending} summarising={summarising} />
        </div>
      ) : (
        <details>
          <summary
            className="cursor-pointer font-mono text-[11px]"
            style={{ color: "var(--color-muted)" }}
          >
            Research log
          </summary>
          <ResearchLogBody outcomes={outcomes ?? []} pending={null} summarising={false} />
        </details>
      ))}
    </div>
  );
}
