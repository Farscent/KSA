import { SIGNAL_LABEL, type HoldingStatus } from "@/lib/flowStatus";

/**
 * Review status of one holding. Names the components that crossed their own
 * threshold instead of a single Review/Stable flag — a count or score would
 * hide which component moved (CLAUDE.md's founding rule).
 */
export function StatusChip({ status }: { status: HoldingStatus }) {
  let label: string;
  let title: string | undefined;
  let tone: "accent" | "neutral" | "warn" | "pending";

  if (status.kind === "not_reviewed") {
    label = "Not reviewed";
    tone = "pending";
    title = "Run Analyst has not reviewed this holding yet.";
  } else if (status.kind === "outdated") {
    label = "Outdated";
    tone = "warn";
    title = `${status.reason}. Re-run Analyst to refresh.`;
  } else if (status.crossed.length > 0) {
    label = status.crossed.map((name) => SIGNAL_LABEL[name]).join(" · ");
    tone = "accent";
    title = "Crossed its own baseline threshold in the last run.";
  } else if (status.unmeasured.length === 3) {
    label = "Not measurable";
    tone = "pending";
    title = "No broker-flow component could be measured for this holding.";
  } else {
    label = "No threshold crossed";
    tone = "neutral";
    title =
      status.unmeasured.length > 0
        ? `Not measurable: ${status.unmeasured.map((n) => SIGNAL_LABEL[n]).join(", ")}.`
        : "Measured against its own baseline. This is not an endorsement.";
  }

  const style = {
    accent: { border: "var(--color-accent)", bg: "var(--color-accent-soft)", fg: "var(--color-accent)", dot: "var(--color-accent)", dashed: false },
    neutral: { border: "var(--color-line)", bg: "var(--color-surface)", fg: "#5a636e", dot: "#b9bfc7", dashed: false },
    warn: { border: "var(--color-warn-border)", bg: "var(--color-warn-bg)", fg: "var(--color-warn)", dot: "var(--color-warn)", dashed: false },
    pending: { border: "var(--color-line-strong)", bg: "transparent", fg: "var(--color-muted)", dot: "transparent", dashed: true },
  }[tone];

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-right font-mono text-[11px] font-medium leading-tight"
      style={{
        borderColor: style.border,
        borderStyle: style.dashed ? "dashed" : "solid",
        background: style.bg,
        color: style.fg,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 flex-none rounded-full"
        style={{ background: style.dot, border: style.dashed ? "1px solid var(--color-muted-2)" : undefined }}
      />
      {label}
    </span>
  );
}
