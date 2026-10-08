"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Summary / Full analysis / Peers for one stock, in one place instead of links
 * scattered across the three pages. Peers is only offered where a peer screen
 * exists, rather than leading to a 404.
 */
export function SymbolTabs({ symbol, hasPeers }: { symbol: string; hasPeers: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/${symbol}`, label: "Summary" },
    { href: `/${symbol}/details`, label: "Full analysis" },
    ...(hasPeers ? [{ href: `/${symbol}/peers`, label: "Peers" }] : []),
  ];

  return (
    <div className="flex gap-2 border-b bg-[var(--color-card)] px-7" style={{ borderColor: "var(--color-line)" }}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="cursor-pointer px-0.5 pb-2.5 pt-3 font-medium text-[12.5px]"
            style={{
              marginRight: 18,
              color: active ? "var(--color-ink)" : "var(--color-muted)",
              borderBottom: `2px solid ${active ? "var(--color-accent)" : "transparent"}`,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
