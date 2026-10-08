import type { FactRow } from "@/lib/agent/display";
import type { ReportSectionLike } from "@/components/ReportSections";
import { idrBig } from "@/lib/agent/display";

const MUTED = "var(--color-muted)";

interface KeyStatsProps {
  /** Sections of the latest saved run; null when the analyst has not run. */
  sections: ReportSectionLike[] | null;
  identity: { market_cap: number | null; sector: string | null; sub_sector: string | null; listing_date: string | null } | null;
}

/** Rows come from the saved report's own fact tables: nothing is recomputed here. */
/** The short list a symbol page needs at a glance; everything else is on Details. */
const SHOWN = [
  "Price-to-earnings (P/E)",
  "Price-to-book (P/B)",
  "Forward P/E (Sectors)",
  "Earnings per share",
  "Return on equity",
  "Net profit margin",
  "Dividend yield, trailing 12 months",
];

function pick(sections: ReportSectionLike[] | null, ids: string[]): FactRow[] {
  const rows = (sections ?? []).filter((s) => ids.includes(s.id)).flatMap((s) => (s.rows as FactRow[] | undefined) ?? []);
  return SHOWN.flatMap((label) => rows.filter((r) => r.label === label));
}

export function KeyStats({ sections, identity }: KeyStatsProps) {
  const rows = pick(sections, ["valuation", "fundamentals"]);
  const about: [string, string][] = [];
  if (identity?.market_cap != null) about.push(["Market cap", idrBig(identity.market_cap)]);
  if (identity?.sector) about.push(["Sector", identity.sector]);
  if (identity?.sub_sector) about.push(["Sub-sector", identity.sub_sector]);
  if (identity?.listing_date) about.push(["Listed", identity.listing_date]);

  return (
    <div className="animate-rise rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
      <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Key stats</div>
      {rows.length === 0 && about.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>
          Run Analyst from the overview to load company figures.
        </p>
      ) : (
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {[...about.map(([label, value]) => ({ label, value, compare: null as string | null })), ...rows].map((r, i) => (
            <div
              key={r.label}
              title={r.compare ?? undefined}
              className="animate-rise flex items-baseline justify-between gap-3 border-b py-2 text-[12px]"
              style={{ borderColor: "var(--color-line-soft)", animationDelay: `${i * 40}ms` }}
            >
              <dt style={{ color: MUTED }}>{r.label}</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--color-ink)]">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-[11px]" style={{ color: MUTED }}>
        Full figures, peer comparisons and sources are in the full analysis.
      </p>
    </div>
  );
}
