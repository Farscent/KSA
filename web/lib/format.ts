/** Display formatters. Pure functions only — no computation of contract values here. */

export function idr(value: number): string {
  return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export function signedIdr(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}Rp ${Math.abs(Math.round(value)).toLocaleString("id-ID")}`;
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function signedPct(fraction: number, digits = 1): string {
  const sign = fraction >= 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

export function count(value: number): string {
  return value.toLocaleString("id-ID");
}
