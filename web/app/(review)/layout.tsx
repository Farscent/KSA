import { HoldingsProvider } from "@/lib/holdings/store";
import { ResultsProvider } from "@/lib/data/ResultsProvider";
import { fetchPositions, fetchPriceHistory, fetchRun } from "@/lib/data/results";
import { fetchHoldings, fetchIntents } from "@/lib/holdings/data";
import { HeaderBar } from "@/components/HeaderBar";
import { TabStrip } from "@/components/TabStrip";

/**
 * Every Supabase read the review screens need happens here, once, on the
 * server. The client components below receive the results through context —
 * see lib/data/ResultsProvider.tsx for why the data is distributed rather than
 * fetched where it is used.
 *
 * Unauthenticated requests never reach this layout: proxy.ts redirects them to
 * /login first, so `auth.uid()` is always present for the RLS-scoped reads.
 */
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  const [positions, holdings, intents, run] = await Promise.all([
    fetchPositions(),
    fetchHoldings(),
    fetchIntents(),
    fetchRun(),
  ]);
  const priceHistory = await fetchPriceHistory(positions.map((p) => p.symbol));

  return (
    <ResultsProvider positions={positions} priceHistory={priceHistory} run={run}>
      <HoldingsProvider initialHoldings={holdings} initialIntents={intents}>
        <div className="min-h-screen flex flex-col items-center px-4 py-7">
          <div
            className="relative w-full overflow-hidden rounded-[10px] border"
            style={{
              maxWidth: 1240,
              background: "var(--color-surface)",
              borderColor: "var(--color-line)",
              boxShadow: "0 1px 3px rgba(0,0,0,.05)",
            }}
          >
            <HeaderBar />
            <TabStrip />
            {children}
          </div>
        </div>
      </HoldingsProvider>
    </ResultsProvider>
  );
}
