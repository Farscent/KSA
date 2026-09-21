"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabStrip() {
  const pathname = usePathname();
  const isHoldings = pathname === "/holdings";
  const isDashboard = pathname === "/";
  const showTabs = isHoldings || isDashboard;
  if (!showTabs) return null;

  const tabClass = "cursor-pointer px-0.5 pt-3.5 pb-2.5 font-medium text-[12.5px]";

  return (
    <div className="flex gap-2 px-7 bg-[var(--color-card)] border-b" style={{ borderColor: "var(--color-line)" }}>
      <Link
        href="/"
        className={tabClass}
        style={{
          marginRight: 18,
          color: isDashboard ? "var(--color-ink)" : "var(--color-muted)",
          borderBottom: `2px solid ${isDashboard ? "var(--color-accent)" : "transparent"}`,
        }}
      >
        Dashboard
      </Link>
      <Link
        href="/holdings"
        className={tabClass}
        style={{
          marginRight: 26,
          color: isHoldings ? "var(--color-ink)" : "var(--color-muted)",
          borderBottom: `2px solid ${isHoldings ? "var(--color-accent)" : "transparent"}`,
        }}
      >
        Add holdings
      </Link>
    </div>
  );
}
