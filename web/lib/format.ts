/** Display formatters. Pure functions only — no computation of contract values here. */

export function idr(value: number): string {
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export function signedIdr(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}Rp ${Math.abs(Math.round(value)).toLocaleString("id-ID")}`;
}

/**
 * Percentages use the same id-ID locale as `idr`, so a decimal separator reads
 * as a comma throughout: `99,3%` alongside `Rp 2.000.000.000`, not `99.3%`.
 *
 * The locale's hyphen is swapped for a true minus (U+2212) to match `signedIdr`
 * — the overview table stacks an amount directly above its percentage, where
 * two different minus glyphs are visible side by side.
 */
function localePercent(fraction: number, digits: number): string {
  const formatted = (fraction * 100).toLocaleString("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatted.replace(/^-/, "−");
}

export function pct(fraction: number, digits = 0): string {
  return `${localePercent(fraction, digits)}%`;
}

export function signedPct(fraction: number, digits = 1): string {
  const sign = fraction >= 0 ? "+" : "";
  return `${sign}${localePercent(fraction, digits)}%`;
}

export function count(value: number): string {
  return value.toLocaleString("id-ID");
}
