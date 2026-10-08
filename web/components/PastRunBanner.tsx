import Link from "next/link";

/**
 * Marks a screen as a saved snapshot. Past runs are rendered only from what was
 * saved at the time, so this banner is what keeps them from being read as
 * today's state.
 */
export function PastRunBanner({
  createdAt,
  asOf,
  backHref = "/history",
  backLabel = "All past runs",
}: {
  createdAt: string;
  asOf: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-b px-7 py-3"
      style={{ borderColor: "var(--color-warn-border)", background: "var(--color-warn-bg)", color: "var(--color-warn)" }}
    >
      <div className="font-mono text-[11.5px]">
        <span className="font-medium uppercase" style={{ letterSpacing: "0.08em" }}>
          Past run {"·"} read-only
        </span>{" "}
        {"—"} saved {new Date(createdAt).toLocaleString()}, data {asOf}. Nothing here reflects today{"'"}s data or your
        current holdings.
      </div>
      <div className="flex items-center gap-4 text-[11.5px] font-medium">
        <Link href={backHref} className="underline">
          {backLabel}
        </Link>
        <Link href="/" className="underline">
          Back to current
        </Link>
      </div>
    </div>
  );
}
