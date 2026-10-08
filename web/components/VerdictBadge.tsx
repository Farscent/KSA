import type { Verdict } from "@/lib/verdict";

const STYLE: Record<Verdict, { border: string; bg: string; fg: string }> = {
  Healthy: { border: "var(--color-line)", bg: "var(--color-surface)", fg: "#5a636e" },
  Watch: { border: "var(--color-warn-border)", bg: "var(--color-warn-bg)", fg: "var(--color-warn)" },
  Rebalance: { border: "var(--color-accent)", bg: "var(--color-accent-soft)", fg: "var(--color-accent)" },
};

/**
 * A triage label, not a combined severity score — per CLAUDE.md, concentration/
 * breadth/persistence stay reported separately underneath this. See
 * lib/verdict.ts for how it's derived.
 */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = STYLE[verdict];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium"
      style={{ borderColor: style.border, background: style.bg, color: style.fg }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: style.fg }} />
      {verdict}
    </span>
  );
}
