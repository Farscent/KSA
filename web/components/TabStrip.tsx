"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/holdings", label: "Add holdings", match: (p: string) => p === "/holdings" },
  { href: "/history", label: "History", match: (p: string) => p === "/history" || p.startsWith("/history/") },
];

export function TabStrip() {
  const pathname = usePathname();
  // Hidden on stock pages, which carry their own tabs.
  if (!TABS.some((t) => t.match(pathname))) return null;

  const tabClass = "cursor-pointer px-0.5 pt-3.5 pb-2.5 font-medium text-[12.5px]";

  return (
    <div className="flex gap-2 px-7 bg-[var(--color-card)] border-b" style={{ borderColor: "var(--color-line)" }}>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={tabClass}
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
