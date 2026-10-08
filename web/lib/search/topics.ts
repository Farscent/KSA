/**
 * The fixed macro search topics. Kept apart from lib/search/tavily.ts (which is
 * `server-only`) so display code and tests can read the labels.
 */
export const MACRO_TOPICS = [
  { id: "policy_rate", label: "Interest rate policy", query: "Bank Indonesia BI rate decision" },
  { id: "inflation", label: "Inflation", query: "Indonesia inflation CPI Statistics Indonesia" },
  { id: "rupiah", label: "Rupiah exchange rate", query: "rupiah exchange rate Indonesia" },
  { id: "regulation", label: "Fiscal and market regulation", query: "Indonesia OJK Ministry of Finance IDX regulation stock market" },
] as const;

export type MacroTopicId = (typeof MACRO_TOPICS)[number]["id"];
