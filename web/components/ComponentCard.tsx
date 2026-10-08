import { Value } from "@/components/Value";
import { pct } from "@/lib/format";
import type { ConcentrationBlock, BreadthBlock, PersistenceBlock, CoverageBlock } from "@/lib/contract/types";

function CardShell({
  title,
  basisLabel,
  highlight,
  headline,
  caption,
  bar,
  footnote,
}: {
  title: string;
  basisLabel: string;
  highlight?: boolean;
  headline: React.ReactNode;
  caption: React.ReactNode;
  bar: React.ReactNode;
  footnote: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border p-3.5"
      style={{ borderColor: "var(--color-line-strong)", background: highlight ? "#faf9f7" : "var(--color-card)" }}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-xs text-[var(--color-ink)]">{title}</span>
        <span className="font-mono text-[10px]" style={{ color: "var(--color-muted-2)" }}>
          {basisLabel}
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="font-mono text-[21px] font-medium tabular-nums text-[var(--color-ink)]">{headline}</span>
        <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          {caption}
        </span>
      </div>
      <div className="mt-2.5">{bar}</div>
      <div className="mt-2 font-mono text-[10.5px] leading-relaxed" style={{ color: highlight ? "var(--color-warn)" : "var(--color-muted-2)" }}>
        {footnote}
      </div>
    </div>
  );
}

function segmentBar(band: number | null, bandCount: number | null) {
  const total = bandCount ?? 5;
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded"
          style={{ background: band !== null && i < band ? "var(--color-accent)" : "var(--color-line-strong)" }}
        />
      ))}
    </div>
  );
}

export function ConcentrationCard({ block }: { block: ConcentrationBlock }) {
  return (
    <CardShell
      title="Concentration"
      basisLabel={block.basis === "MEASURED" ? "measured" : "example"}
      headline={<Value value={block.share} format="pct" />}
      caption={`of sell value in top ${block.top_n ?? "n"} brokers`}
      bar={segmentBar(block.band, block.band_count)}
      footnote={
        block.value_status === "AVAILABLE" ? (
          <>
            Baseline <Value value={block.baseline_share} format="pct" /> {"·"} band {block.band} of {block.band_count}
          </>
        ) : (
          "Not computed this run"
        )
      }
    />
  );
}

export function BreadthCard({ block }: { block: BreadthBlock }) {
  const available = block.value_status === "AVAILABLE";
  return (
    <CardShell
      title="Breadth"
      basisLabel={block.basis === "MEASURED" ? "measured" : "example"}
      headline={available ? `${block.changed} / ${block.active}` : "unavailable"}
      caption="brokers changed side"
      bar={
        <div className="h-1.5 overflow-hidden rounded" style={{ background: "var(--color-line-strong)" }}>
          <div
            className="h-full"
            style={{ width: available ? `${(block.share ?? 0) * 100}%` : "0%", background: "var(--color-accent)" }}
          />
        </div>
      }
      footnote={
        available ? (
          <>
            {pct(block.share ?? 0)} of active brokers {"·"} baseline {pct(block.baseline_share ?? 0)}
          </>
        ) : (
          "Breadth was not computed this run — shown as unavailable, never as zero brokers."
        )
      }
    />
  );
}

export function PersistenceCard({ block }: { block: PersistenceBlock }) {
  const available = block.value_status === "AVAILABLE";
  return (
    <CardShell
      title="Persistence"
      basisLabel={block.basis === "MEASURED" ? "measured" : "example"}
      headline={available ? `${block.same_direction} / ${block.of_sessions}` : "unavailable"}
      caption="sessions same direction"
      bar={
        <div className="flex gap-1">
          {(block.session_flags ?? []).map((flag, i) => (
            <span key={i} className="h-1.5 flex-1" style={{ background: flag ? "var(--color-accent)" : "var(--color-line-strong)" }} />
          ))}
        </div>
      }
      footnote={available ? <>Longest run {block.longest_run} {block.longest_run === 1 ? "session" : "sessions"} {"·"} oldest at left</> : "Not computed this run"}
    />
  );
}

export function CoverageCard({ block }: { block: CoverageBlock }) {
  return (
    <CardShell
      title="Data coverage"
      basisLabel="measured"
      highlight
      headline={<Value value={block.matched_share} format="pct" />}
      caption="of traded value matched to a cohort"
      bar={
        <div className="h-1.5 overflow-hidden rounded" style={{ background: "var(--color-line-strong)" }}>
          <div className="h-full" style={{ width: `${(block.matched_share ?? 0) * 100}%`, background: "var(--color-warn)" }} />
        </div>
      }
      footnote={
        block.completeness === "PARTIAL"
          ? "Partial — unknown cohort unavailable for this window"
          : block.completeness
      }
    />
  );
}
