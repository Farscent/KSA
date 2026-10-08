interface NarrativeCardProps {
  paragraphs: string[];
}

/**
 * Renders serve_narrative.paragraphs verbatim. This component performs no
 * computation and adds no figures of its own — every number in the prose
 * already came from serve_narrative.grounded_in fields, per CLAUDE.md's rule
 * that the LLM never does math and the frontend must not either.
 */
export function NarrativeCard({ paragraphs }: NarrativeCardProps) {
  return (
    <div className="rounded-lg border p-4.5" style={{ borderColor: "var(--color-accent)", background: "var(--color-card)" }}>
      <div className="font-medium text-[13.5px] text-[var(--color-ink)]">What the numbers show</div>
      <div className="mt-3 font-serif text-[12.5px] leading-loose" style={{ color: "#252c33" }}>
        {paragraphs.map((p, i) => (
          <p key={i} className={i > 0 ? "mt-3" : undefined}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
