import type { EvidenceCoverage } from "@/lib/agent/coverage";

interface EvidenceCoverageCardProps {
  coverage: EvidenceCoverage;
}

function List({ title, items, mark, color }: { title: string; items: string[]; mark: string; color: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase" style={{ letterSpacing: "0.07em", color: "var(--color-muted)" }}>
        {title}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: "var(--color-ink)" }}>
            <span className="flex-none font-mono" style={{ color }}>
              {mark}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the report stands on, what it could not stand on, and what a reader
 * could check next. Built in code (lib/agent/coverage.ts) — it carries no
 * grade or confidence number, so "not flagged" and "not measurable" stay apart.
 */
export function EvidenceCoverageCard({ coverage }: EvidenceCoverageCardProps) {
  if (coverage.confirmed.length + coverage.gaps.length + coverage.next_checks.length === 0) return null;
  return (
    <div className="rounded-lg border bg-[var(--color-card)] p-5" style={{ borderColor: "var(--color-line)" }}>
      <div className="font-medium text-[13.5px] text-[var(--color-ink)]">Evidence coverage</div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
        What this report rests on, and what it could not measure.
      </div>
      <div className="mt-3.5 flex flex-col gap-3.5">
        <List title="Confirmed" items={coverage.confirmed} mark="✓" color="var(--color-muted)" />
        <List title="Not measured or limited" items={coverage.gaps} mark="–" color="var(--color-warn)" />
        <List title="Worth checking next" items={coverage.next_checks} mark="→" color="var(--color-accent)" />
      </div>
    </div>
  );
}
