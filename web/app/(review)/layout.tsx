import { HoldingsProvider } from "@/lib/holdings/store";
import { HeaderBar } from "@/components/HeaderBar";
import { TabStrip } from "@/components/TabStrip";

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <HoldingsProvider>
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
  );
}
