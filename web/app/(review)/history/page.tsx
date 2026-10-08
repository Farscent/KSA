import Link from "next/link";

import { fetchAgentRunsLite } from "@/lib/data/agentRuns";
import { fetchPortfolioRunList } from "@/lib/data/portfolioRuns";
import { componentCounts, describeDiff, diffRuns, digestOfSaved, type RunDigest } from "@/lib/history/diff";
import { SIGNAL_LABEL, type SignalName } from "@/lib/flowStatus";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

const NAMES: SignalName[] = ["concentration", "breadth", "persistence"];

export default async function HistoryPage() {
  const runs = await fetchPortfolioRunList();
  const perRun = await fetchAgentRunsLite(runs.map((r) => r.id));
  const digestsOf = (id: string): RunDigest[] | null => {
    const rows = perRun.get(id);
    return rows ? rows.map(digestOfSaved) : null;
  };

  return (
    <>
      <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-6" style={{ borderColor: "var(--color-line)" }}>
        <div className="font-mono text-[11px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.1em" }}>
          History
        </div>
        <div className="mt-1.5 font-serif text-[22px] text-[var(--color-ink)]">Past Run Analyst passes</div>
        <div className="mt-1.5 max-w-[640px] text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
          Every saved run, newest first. Opening one shows it exactly as it was saved {"—"} its own data date, its own
          reports and verdicts {"—"} never today{"'"}s state. Counts are per component and are not added together.
        </div>
      </div>

      <div className="mx-auto flex max-w-[1000px] flex-col gap-3.5 p-7">
        {runs.length === 0 && (
          <div className="rounded-lg border bg-[var(--color-card)] p-5 text-xs" style={{ borderColor: "var(--color-line)", color: "var(--color-muted)" }}>
            No runs saved yet. Run Analyst from the{" "}
            <Link href="/" className="underline" style={{ color: "var(--color-accent)" }}>
              dashboard
            </Link>{" "}
            and it will appear here.
          </div>
        )}
        {runs.map((r, i) => {
          const digests = digestsOf(r.id);
          const previous = runs[i + 1] ? digestsOf(runs[i + 1].id) : null;
          const counts = digests ? componentCounts(digests) : null;
          const diffLines = digests && previous ? describeDiff(diffRuns(digests, previous)) : null;
          return (
            <Link
              key={r.id}
              href={`/history/${r.id}`}
              className="rounded-lg border bg-[var(--color-card)] p-4.5 hover:bg-[var(--color-surface)]"
              style={{ borderColor: "var(--color-line)" }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium text-[13.5px] text-[var(--color-ink)]">
                  {new Date(r.created_at).toLocaleString()}
                  {i === 0 && (
                    <span className="ml-2 font-mono text-[10px] uppercase" style={{ color: "var(--color-accent)", letterSpacing: "0.08em" }}>
                      Latest
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
                  data {r.as_of} {"·"} {r.symbols.length} holdings
                  {r.credits_used !== null ? ` · ${r.credits_used} credits` : ""}
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px]">
                {counts ? (
                  NAMES.map((name) => (
                    <span key={name}>
                      <span style={{ color: "var(--color-muted)" }}>{SIGNAL_LABEL[name]} crossed </span>
                      <span className="text-[var(--color-ink)]">
                        {counts[name]} of {digests?.length}
                      </span>
                    </span>
                  ))
                ) : (
                  <span style={{ color: "var(--color-muted)" }}>Per-holding detail was not recorded for this run.</span>
                )}
              </div>

              {diffLines && (
                <div className="mt-2 flex flex-col gap-0.5 text-[11.5px]" style={{ color: "var(--color-muted)" }}>
                  {diffLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              )}
              {!diffLines && i === runs.length - 1 && (
                <div className="mt-2 text-[11.5px]" style={{ color: "var(--color-muted)" }}>
                  First saved run
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <DisclaimerFooter />
    </>
  );
}
