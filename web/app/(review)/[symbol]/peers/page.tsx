"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAgentRun } from "@/lib/data/ResultsProvider";
import { buildPeerScreen } from "@/lib/agent/peerScreen";
import { RunSymbolButton } from "@/components/RunSymbolButton";
import { ExcludedTable } from "@/components/ExcludedTable";
import { ScorecardGrid } from "@/components/ScorecardGrid";
import { IntentButtons } from "@/components/IntentButtons";
import { Toast } from "@/components/Toast";
import { SymbolTabs } from "@/components/SymbolTabs";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function PeerComparisonPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = rawSymbol.toUpperCase();
  const [toast, setToast] = useState<string | null>(null);

  const run = useAgentRun(symbol);
  const screen = run ? buildPeerScreen(symbol, run) : null;

  function fireToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  if (!screen) {
    return (
      <>
        <SymbolTabs symbol={symbol} hasPeers={Boolean(run?.peers)} />
        <div className="flex flex-col items-start gap-3 p-7">
          <div className="font-serif text-[21px] text-[var(--color-ink)]">No peer screen for {symbol} yet</div>
          <div className="max-w-[640px] text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
            {run
              ? "The saved review has no peer data. Run Analyst again to screen peers."
              : "Peers are screened when Run Analyst reviews this stock."}
          </div>
          <RunSymbolButton symbol={symbol} hasRun={Boolean(run)} />
        </div>
        <DisclaimerFooter right="Peer eligibility rules · v0.4 draft" />
      </>
    );
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

      <SymbolTabs symbol={symbol} hasPeers />

      <div className="flex flex-col gap-5 p-7">
        <ExcludedTable excluded={screen.excluded} />
        {screen.shortlist.length === 0 ? (
          <div
            className="rounded-lg border bg-[var(--color-card)] px-4.5 py-4 text-[13px]"
            style={{ borderColor: "var(--color-line)", color: "var(--color-ink)" }}
          >
            No comparable alternative qualified. Every screened candidate is listed above with its reason.
          </div>
        ) : (
          <ScorecardGrid symbol={screen.symbol} shortlist={screen.shortlist} scorecard={screen.scorecard} />
        )}
        <IntentButtons symbol={symbol} onRecorded={fireToast} />
      </div>

      <DisclaimerFooter right="Peer eligibility rules · v0.4 draft" />
      <Toast message={toast} />
    </>
  );
}
