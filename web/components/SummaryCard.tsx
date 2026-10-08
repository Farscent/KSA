import Link from "next/link";

import type { FactRow } from "@/lib/agent/display";
import type { SymbolSummary } from "@/lib/agent/summary";
import type { EvidenceCoverage } from "@/lib/agent/coverage";

const MUTED = "var(--color-muted)";

function Tile({ row, quiet, index = 0 }: { row: FactRow; quiet?: boolean; index?: number }) {
  const differs = row.tone === "differs";
  const gap = row.tone === "gap";
  return (
    <div
      className="animate-rise rounded-md border p-3.5"
      style={{
        borderColor: differs ? "var(--color-accent)" : "var(--color-line-strong)",
        background: quiet ? "var(--color-surface)" : "var(--color-card)",
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div className="text-[11.5px] leading-snug" style={{ color: MUTED }}>
        {row.label}
      </div>
      <div className="mt-1.5 font-mono text-[19px] font-medium tabular-nums text-[var(--color-ink)]">{row.value}</div>
      {row.compare && (
        <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
          {row.compare}
        </div>
      )}
      {row.status && (
        <div
          className="mt-1.5 text-[12px] font-medium"
          style={{ color: differs ? "var(--color-accent)" : gap ? "var(--color-warn)" : "var(--color-ink)" }}
        >
          {row.status}
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  summary: SymbolSummary;
  coverage: EvidenceCoverage | null;
  symbol: string;
}

/**
 * The one-screen reading of a saved report: what was found, the three flow
 * components side by side, and at most three other things that stand out.
 * Built in code from the report's own rows (lib/agent/summary.ts).
 */
export function SummaryCard({ summary, coverage, symbol }: SummaryCardProps) {
  const tiles = summary.components.slice(0, 3);
  const dataCoverage = summary.components[3];
  return (
    <div className="animate-rise rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
      {summary.finding && (
        <p className="text-[15px] font-medium leading-7 text-[var(--color-ink)]">{summary.finding}</p>
      )}

      {tiles.length > 0 && (
        <>
          <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {tiles.map((row, i) => (
              <Tile key={row.label} row={row} index={i} />
            ))}
            {dataCoverage && <Tile row={dataCoverage} quiet index={3} />}
          </div>
          <div className="mt-2 text-[11px]" style={{ color: MUTED }}>
            Three separate findings, each against this stock&apos;s own baseline. There is no combined score.
          </div>
        </>
      )}

      {summary.standouts.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[10.5px] uppercase" style={{ letterSpacing: "0.07em", color: MUTED }}>
            What stands out
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {summary.standouts.map((row, i) => (
              <li
                key={row.label}
                className="animate-rise text-[13px] leading-6 text-[var(--color-ink)]"
                style={{ animationDelay: `${300 + i * 70}ms` }}
              >
                <span className="font-medium">{row.label}</span> — {row.value}
                {row.status ? ` · ${row.status}` : ""}
              </li>
            ))}
          </ul>
          {summary.moreStandouts > 0 && (
            <div className="mt-1.5 text-[12px]" style={{ color: MUTED }}>
              +{summary.moreStandouts} more in the full analysis
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4" style={{ borderColor: "var(--color-line-soft)" }}>
        <Link
          href={`/${symbol}/details`}
          className="rounded-md px-3.5 py-2.5 font-medium text-xs text-white transition hover:brightness-110"
          style={{ background: "var(--color-accent)" }}
        >
          View full analysis
        </Link>
        {coverage && (
          <span className="text-[12px]" style={{ color: MUTED }}>
            {coverage.confirmed.length} confirmed · {coverage.gaps.length} not measured or limited
          </span>
        )}
      </div>
    </div>
  );
}
