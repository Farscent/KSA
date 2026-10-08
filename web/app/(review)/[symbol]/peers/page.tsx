"use client";

import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPeerScreen } from "@/lib/data/source";
import { ExcludedTable } from "@/components/ExcludedTable";
import { ScorecardGrid } from "@/components/ScorecardGrid";
import { IntentButtons } from "@/components/IntentButtons";
import { Toast } from "@/components/Toast";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function PeerComparisonPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();
  const [toast, setToast] = useState<string | null>(null);

  const screen = getPeerScreen(symbol);
  if (!screen) notFound();

  function fireToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  return (
    <>
      <div className="border-b bg-[var(--color-card)] px-7 pb-4.5 pt-5.5" style={{ borderColor: "var(--color-line)" }}>
        <Link
          href={`/${symbol}`}
          className="mb-3.5 inline-flex items-center gap-1.5 font-medium text-xs"
          style={{ color: "var(--color-accent)" }}
        >
          {"←"} Back to {symbol} report
        </Link>
        <div className="font-mono text-[11px] uppercase text-[var(--color-muted)]" style={{ letterSpacing: "0.1em" }}>
          Peer set {"·"} {screen.peer_set_label}
        </div>
        <div className="mt-1.5 font-serif text-[21px] text-[var(--color-ink)]">
          {screen.screened} candidates screened {"·"} {screen.excluded.length} excluded {"·"}{" "}
          {screen.shortlist.length} shortlisted
        </div>
        <div className="mt-1.5 max-w-[820px] text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
          Exclusions are shown before results so the shortlist can be read in context. A peer appearing here is not
          a recommendation to switch into it.
        </div>
      </div>

      <div className="flex flex-col gap-5 p-7">
        <ExcludedTable excluded={screen.excluded} />
        <ScorecardGrid symbol={screen.symbol} shortlist={screen.shortlist} scorecard={screen.scorecard} />
        <IntentButtons symbol={symbol} onRecorded={fireToast} />
      </div>

      <DisclaimerFooter right="Peer eligibility rules · v0.4 draft" />
      <Toast message={toast} />
    </>
  );
}
