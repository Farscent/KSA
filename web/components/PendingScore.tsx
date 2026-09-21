interface PendingScoreProps {
  score: number | null;
  severity: string | null;
  scoringStatus: string;
}

/**
 * Renders score/severity as pending, never as zero, neutral, low-risk, or an
 * all-clear — the rule docs/serve-contract.md states explicitly. Every place
 * that would otherwise show a severity number goes through this component
 * until scoring_status leaves PENDING_DEFINITION.
 */
export function PendingScore({ score, severity, scoringStatus }: PendingScoreProps) {
  const pending = scoringStatus === "PENDING_DEFINITION" || score === null || severity === null;

  if (!pending) {
    // Scored state is not yet defined by the contract; when it lands this
    // branch renders the real score/severity. Until then this path is unused.
    return (
      <span className="font-medium text-[var(--color-ink)]">
        {severity} {"·"} {score}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium text-[var(--color-muted)]">pending</span>
      <span
        className="rounded border border-dashed px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
        style={{
          borderColor: "var(--color-warn-border)",
          background: "var(--color-warn-bg)",
          color: "var(--color-warn)",
          letterSpacing: "0.06em",
        }}
      >
        Example values {"—"} scoring not finalised
      </span>
    </span>
  );
}
