interface DisclaimerFooterProps {
  right?: string;
}

/** Compliance rule: every screen showing computed data must carry this notice. */
export function DisclaimerFooter({ right }: DisclaimerFooterProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-1.5 px-7 py-3 font-mono text-[11px]"
      style={{ background: "var(--color-header)", color: "#9aa4b0", letterSpacing: "0.03em" }}
    >
      <span>Decision support only {"—"} not financial advice.</span>
      {right && <span>{right}</span>}
    </div>
  );
}
