import { count, idr, pct, signedIdr, signedPct } from "@/lib/format";

type Formatter = "idr" | "signedIdr" | "pct" | "signedPct" | "count" | "raw";

const FORMATTERS: Record<Exclude<Formatter, "raw">, (n: number) => string> = {
  idr,
  signedIdr,
  pct,
  signedPct,
  count,
};

interface ValueProps {
  /** null/undefined means unavailable — a string is rendered as-is (e.g. a ratio label). */
  value: number | string | null | undefined;
  format?: Formatter;
  unavailableLabel?: string;
  className?: string;
}

/**
 * Renders any contract value. Given an unavailable value it renders the word
 * "unavailable" (or a caller-supplied label), never 0, never a bare dash that
 * could be misread as zero. Every number sourced from serve_* data should be
 * rendered through this component rather than interpolated directly.
 */
export function Value({ value, format = "raw", unavailableLabel = "unavailable", className }: ValueProps) {
  if (value === null || value === undefined) {
    return <span className={`text-[var(--color-muted-2)] ${className ?? ""}`}>{unavailableLabel}</span>;
  }
  if (typeof value === "string") {
    return <span className={className}>{value}</span>;
  }
  const text = format === "raw" ? String(value) : FORMATTERS[format](value);
  return <span className={className}>{text}</span>;
}
