"use client";

import { useState } from "react";
import { getPositions } from "@/lib/data/source";

interface SymbolAutocompleteProps {
  value: string;
  onPick: (symbol: string) => void;
  onQueryChange: (query: string) => void;
  excludeSymbols: Set<string>;
  isPicked: boolean;
}

export function SymbolAutocomplete({ value, onPick, onQueryChange, excludeSymbols, isPicked }: SymbolAutocompleteProps) {
  const [focused, setFocused] = useState(false);
  const positions = getPositions();
  const query = value.toUpperCase();
  const suggestions = isPicked
    ? []
    : positions.filter((p) => p.symbol.includes(query) && !excludeSymbols.has(p.symbol)).slice(0, 6);
  const showAutocomplete = focused && !isPicked;
  const noSuggestions = showAutocomplete && suggestions.length === 0;

  return (
    <div className="relative mt-1.5">
      <input
        value={value}
        onChange={(e) => onQueryChange(e.target.value.toUpperCase())}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        placeholder="Type a symbol, e.g. BBCA"
        className="w-full box-border rounded-md border px-2.5 py-2 font-mono text-[13px] font-medium text-[var(--color-ink)] bg-[var(--color-card)]"
        style={{ borderColor: isPicked ? "var(--color-accent)" : "var(--color-input-border)" }}
      />
      {showAutocomplete && (
        <div
          className="absolute left-0 right-0 top-11 z-10 max-h-[220px] overflow-y-auto rounded-md border bg-[var(--color-card)]"
          style={{ borderColor: "var(--color-line)", boxShadow: "0 8px 20px rgba(21,25,30,.11)" }}
        >
          {suggestions.map((s) => (
            <div
              key={s.symbol}
              onMouseDown={() => onPick(s.symbol)}
              className="flex cursor-pointer items-center justify-between border-b px-2.5 py-2.5"
              style={{ borderColor: "var(--color-line-soft)" }}
            >
              <span className="font-mono text-[12.5px] font-medium text-[var(--color-ink)]">
                {s.symbol}
                <span style={{ color: "var(--color-muted-2)" }}>{" · "}</span>
                <span className="font-sans text-xs font-normal" style={{ color: "#3d4650" }}>{s.name}</span>
              </span>
              <span className="font-mono text-[10px] text-[var(--color-muted)]">{s.sector}</span>
            </div>
          ))}
          {noSuggestions && (
            <div className="px-2.5 py-2.5 text-xs" style={{ color: "var(--color-muted-2)" }}>
              No matching IDX symbol.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
