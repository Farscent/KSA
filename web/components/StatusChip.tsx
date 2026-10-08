export function StatusChip({ flagged }: { flagged: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium"
      style={
        flagged
          ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
          : { borderColor: "var(--color-line)", background: "var(--color-surface)", color: "#5a636e" }
      }
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: flagged ? "var(--color-accent)" : "#b9bfc7" }}
      />
      {flagged ? "Review" : "Stable"}
    </span>
  );
}
