import "server-only";

import { normalizeSymbol } from "@/lib/sectors/client";
import { getOrFetch, type CreditLedger, type FetchResult } from "@/lib/sectors/cache";

/**
 * One narrow function per Sectors endpoint — recipe 01's "wrap each endpoint
 * as one tool". Each declares its own credit cost from AGENTS.md's verified
 * table, so the ledger never has to guess.
 *
 * `sections=` is always passed explicitly: omitting it bills every section.
 */

export type CompanySection =
  | "overview"
  | "valuation"
  | "future"
  | "peers"
  | "financials"
  | "dividend"
  | "management"
  | "ownership";

export type SubsectorSection =
  | "statistics"
  | "market_cap"
  | "stability"
  | "valuation"
  | "growth"
  | "companies";

/** 1 credit per requested section. */
export function companyReport(
  symbol: string,
  sections: CompanySection[],
  ledger: CreditLedger
): Promise<FetchResult> {
  if (sections.length === 0) throw new Error("companyReport requires at least one section");
  const sym = normalizeSymbol(symbol);
  return getOrFetch(`company/report/${sym}/`, { sections: sections.join(",") }, {
    credits: sections.length,
    ledger,
  });
}

/** 1 credit per requested section. Cached by slug, so symbols sharing a
 * subsector (the four banks in the demo universe) pay for it once. */
export function subsectorReport(
  slug: string,
  sections: SubsectorSection[],
  ledger: CreditLedger
): Promise<FetchResult> {
  if (sections.length === 0) throw new Error("subsectorReport requires at least one section");
  return getOrFetch(`subsector/report/${slug}/`, { sections: sections.join(",") }, {
    credits: sections.length,
    ledger,
  });
}

/** 1 credit per quarter returned. */
export function quarterlyFinancials(
  symbol: string,
  nQuarters: number,
  ledger: CreditLedger
): Promise<FetchResult> {
  const sym = normalizeSymbol(symbol);
  return getOrFetch(`financials/quarterly/${sym}/`, { n_quarters: String(nQuarters) }, {
    credits: nQuarters,
    ledger,
  });
}

/** Nearby context. 1 credit each. Shorter TTL than fundamentals: a week-old
 * news list would be stale in a way a week-old annual report is not. */
const CONTEXT_TTL_DAYS = 1;

/** `extension=idx` is required, and the symbol filter is `symbols` (plural,
 * comma-separated) — not `symbol`. Verified against the v2 reference. */
export function news(symbol: string, ledger: CreditLedger, limit = 10): Promise<FetchResult> {
  const sym = normalizeSymbol(symbol);
  return getOrFetch("news/", { extension: "idx", symbols: sym, limit: String(limit) }, {
    credits: 1,
    ledger,
    ttlDays: CONTEXT_TTL_DAYS,
  });
}

export function filings(symbol: string, ledger: CreditLedger, limit = 10): Promise<FetchResult> {
  const sym = normalizeSymbol(symbol);
  return getOrFetch("filings/", { symbol: sym, limit: String(limit) }, {
    credits: 1,
    ledger,
    ttlDays: CONTEXT_TTL_DAYS,
  });
}

/** Lives under `company/`, unlike news and filings. */
export function corporateActions(symbol: string, ledger: CreditLedger): Promise<FetchResult> {
  const sym = normalizeSymbol(symbol);
  return getOrFetch(`company/corporate-actions/${sym}/`, {}, {
    credits: 1,
    ledger,
    ttlDays: CONTEXT_TTL_DAYS,
  });
}
