/**
 * Holding units, kept free of React so pure calculation modules can import
 * them without pulling in a "use client" component tree.
 *
 * `lib/holdings/store.tsx` re-exports both, so existing imports are unchanged.
 */

/** IDX trades in lots of 100 shares. */
export const SHARES_PER_LOT = 100;

/** Maximum positions a user may track. */
export const HOLDINGS_CAP = 15;
