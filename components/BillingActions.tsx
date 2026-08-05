"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREDIT_PACKS } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

async function startCheckout(body: object) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
}

export function BuyAccessButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await startCheckout({ type: "access" });
      }} className="w-full justify-center">
      {busy ? "Redirecting…" : "Unlock Affiliate Offer Secrets — $97 one-time"}
    </Button>
  );
}

export function StartTrialButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const { error } = await createClient().rpc("start_trial");
          setBusy(false);
          if (error) return setError(error.message);
          router.push("/dashboard");
          router.refresh();
        }} className="w-full justify-center">
        {busy ? "Starting…" : "Start free 30-day trial"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function BuyCreditsGrid() {
  const [busy, setBusy] = useState<number | null>(null);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {CREDIT_PACKS.map((pack) => (
        <button
          key={pack.credits}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(pack.credits);
            await startCheckout({ type: "credits", credits: pack.credits });
          }}
          className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-center hover:border-emerald-500 disabled:opacity-50"
        >
          <div className="text-lg font-bold text-zinc-100">{pack.credits} credits</div>
          <div className="text-xs text-zinc-500">${pack.cents / 100}</div>
        </button>
      ))}
    </div>
  );
}
