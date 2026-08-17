"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CertificateState } from "@/lib/netlify/ssl";

/**
 * The HTTPS certificate actually being served for one domain.
 *
 * Checked on demand, not on page load: it's a TLS handshake per domain, and a tenant with a dozen
 * of them shouldn't pay twelve handshakes to open Settings.
 *
 * It reports what a VISITOR'S BROWSER would do rather than what a provider claims, which is the
 * only version worth showing. Netlify exposes no per-domain certificate state at all — one
 * certificate covers the site's primary domain plus every attached alias — so "is this domain
 * secured" genuinely has to be measured. Measuring it also surfaces the case a status field would
 * miss entirely: an edge that answers, with a certificate that doesn't name this host, which a
 * browser refuses outright.
 */
export default function DomainSslStatus({ domainId }: { domainId: string }) {
  const [state, setState] = useState<CertificateState | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    const res = await fetch(`/api/domains/${domainId}/ssl`, { method: "POST" });
    setState(res.ok ? await res.json() : null);
    setBusy(false);
  }

  const expiringSoon = state?.daysRemaining != null && state.daysRemaining <= 21;

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
          <Lock className="h-3.5 w-3.5" /> HTTPS certificate
        </p>
        <Button onClick={check} disabled={busy} variant="outline" className="!py-1 text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {state ? "Re-check" : "Check certificate"}
        </Button>
      </div>

      {!state ? (
        <p className="text-xs text-zinc-500">
          Netlify issues and renews certificates automatically once a domain is attached and its DNS
          resolves here — usually within a few minutes. Check to see what&apos;s actually being
          served.
        </p>
      ) : state.secured ? (
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <p className="text-xs text-zinc-400">
            Secured by <span className="text-zinc-200">{state.issuer ?? "the issuer"}</span>
            {state.daysRemaining != null && (
              <>
                {" · renews automatically, "}
                <span className={expiringSoon ? "text-amber-300" : "text-zinc-300"}>
                  {state.daysRemaining} days left
                </span>
              </>
            )}
            {/* Netlify renews well before expiry, so a short window is only worth flagging — not
                alarming — and it is the one case where "automatic" might not have happened. */}
            {expiringSoon && " — if this doesn't move in the next few days, re-check your DNS."}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <p className="text-xs text-amber-200">{state.problem ?? "This domain isn't serving HTTPS yet."}</p>
        </div>
      )}
    </div>
  );
}
