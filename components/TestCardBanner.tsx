"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Stripe's documented test card, shown so someone testing signup doesn't have to go and look it up.
 *
 * Lives above the WHOLE signup form rather than inside the card step, because that is where it's
 * useful: you want to know the flow is safe to run before you start typing an email into it, not
 * after you've already committed to step 2.
 *
 * ONLY renders against a `pk_test_` key. On a live key this would be telling real paying customers
 * to type a number that will be declined — so the gate is the point of the component, not a detail.
 */

const PUBLISHABLE = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

export const STRIPE_TEST_MODE = PUBLISHABLE.startsWith("pk_test_");

const CARD = {
  number: "4242 4242 4242 4242",
  expiry: "any future date",
  cvc: "any 3 digits",
  zip: "any 5 digits",
};

export default function TestCardBanner({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!STRIPE_TEST_MODE) return null;

  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-amber-300">Test mode — no real charge</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(CARD.number.replace(/\s/g, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex shrink-0 items-center gap-1 text-[11px] text-amber-300/80 hover:text-amber-200"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy number"}
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-amber-200/70">
        <dt>Card</dt>
        <dd className="font-mono text-amber-100">{CARD.number}</dd>
        <dt>Expiry</dt>
        <dd>{CARD.expiry}</dd>
        <dt>CVC</dt>
        <dd>{CARD.cvc}</dd>
        <dt>ZIP</dt>
        <dd>{CARD.zip}</dd>
      </dl>
    </div>
  );
}
