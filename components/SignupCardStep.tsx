"use client";

import { useCallback, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { ShieldCheck, Copy, Check } from "lucide-react";

/**
 * Step 2 of signup: put a card on file. Charges nothing.
 *
 * The form is Stripe's own, mounted in an iframe by EmbeddedCheckout — card data never enters this
 * app's DOM, which is why this is embedded rather than a set of inputs we own. Don't "simplify"
 * this into real <input> fields for a card number; that moves the whole app into PCI scope.
 *
 * Skippable on purpose. The 30-day trial is already active by the time this renders (granted in
 * handle_new_user, 0075), so blocking the app behind a card would be a paywall the product doesn't
 * have. Someone who skips can add a card later from Settings → Billing.
 */

const PUBLISHABLE = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
// Module scope, per Stripe's own guidance — loadStripe called inside the component re-fetches
// Stripe.js on every render.
const stripePromise = PUBLISHABLE ? loadStripe(PUBLISHABLE) : null;

// Stripe's documented test card. Shown ONLY against a pk_test_ key: on a live key this banner
// would be telling real paying customers to type a number that will be declined.
const TEST_MODE = PUBLISHABLE.startsWith("pk_test_");
const TEST_CARD = { number: "4242 4242 4242 4242", expiry: "any future date", cvc: "any 3 digits", zip: "any 5 digits" };

function TestCardBanner() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-300">Test mode — no real charge</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(TEST_CARD.number.replace(/\s/g, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 text-[11px] text-amber-300/80 hover:text-amber-200"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy number"}
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-amber-200/70">
        <dt>Card</dt>
        <dd className="font-mono text-amber-100">{TEST_CARD.number}</dd>
        <dt>Expiry</dt>
        <dd>{TEST_CARD.expiry}</dd>
        <dt>CVC</dt>
        <dd>{TEST_CARD.cvc}</dd>
        <dt>ZIP</dt>
        <dd>{TEST_CARD.zip}</dd>
      </dl>
    </div>
  );
}

export default function SignupCardStep({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const fetchClientSecret = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/setup-session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not start the card form.");
      }
      const { clientSecret } = await res.json();
      return clientSecret as string;
    } catch (err) {
      // Surfaced in our own UI rather than left to Stripe's iframe, which never mounts if this
      // rejects — the person would otherwise see an empty white box with no explanation.
      setError(err instanceof Error ? err.message : "Could not start the card form.");
      throw err;
    }
  }, []);

  // Fires when Stripe has saved the card. The webhook is what actually records it against the
  // profile — this only advances the UI, so a webhook that lands a second later changes nothing
  // the person is looking at.
  const onComplete = useCallback(() => onDone(), [onDone]);

  // No publishable key configured: say so plainly and let them through rather than dead-ending a
  // signup on a missing env var. The account and the trial already exist at this point.
  if (!stripePromise) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-zinc-300">Card setup isn&apos;t configured yet.</p>
        <p className="text-xs text-zinc-500">
          Set <code className="text-zinc-400">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to enable
          this step. Your account and 30-day trial are already active.
        </p>
        <button onClick={onDone} className="text-xs text-emerald-400 hover:text-emerald-300">
          Continue to the dashboard →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900/60 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <p className="text-xs leading-relaxed text-zinc-400">
          Your 30-day trial is <span className="text-zinc-200">already active</span> — this saves a
          card for when it ends. <span className="text-zinc-200">You won&apos;t be charged today.</span>
        </p>
      </div>

      {TEST_MODE && <TestCardBanner />}

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret, onComplete }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
      >
        Skip for now — add a card later in Settings
      </button>
    </div>
  );
}
