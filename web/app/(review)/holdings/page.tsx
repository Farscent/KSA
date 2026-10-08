"use client";

import Link from "next/link";
import { HoldingForm } from "@/components/HoldingForm";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function HoldingsPage() {
  return (
    <>
      <HoldingForm />
      <div className="px-7 pb-7">
        <Link
          href="/"
          className="inline-block rounded-md border px-4.5 py-2.5 font-medium text-[12.5px]"
          style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}
        >
          Continue to overview {"→"}
        </Link>
      </div>
      <DisclaimerFooter />
    </>
  );
}
