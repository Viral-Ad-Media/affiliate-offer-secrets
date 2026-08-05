"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldX, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

type EraseResult = {
  contacts_deleted: number;
  mail_sends_redacted: number;
  broadcast_sends_redacted: number;
};

// Answering a GDPR/CCPA erasure request. Deliberately keyed by EMAIL, not by row: a person asking
// to be erased doesn't know which of your campaigns captured them, and they may be in several.
//
// Deleting the contact row alone wouldn't be a truthful erasure — their address is also sitting in
// the send logs, so erase_contact_email (0051) redacts those in the same transaction. The send rows
// themselves survive: that an email went out is a real audit record, and the pooled daily rate cap
// counts it.
export default function ContactErasePanel() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EraseResult | null>(null);

  async function erase(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!target) return;
    if (
      !window.confirm(
        `Erase every record of ${target}?\n\nTheir contact rows are deleted and their address is ` +
          `removed from your send history. This can't be undone.`
      )
    )
      return;

    setBusy(true);
    setResult(null);
    const { data, error } = await createClient().rpc("erase_contact_email", { p_email: target });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const r = data as EraseResult;
    setResult(r);
    // A zero result is a real, useful answer ("we hold nothing for them"), not a failure — so it
    // gets a plain info toast rather than an error.
    if (r.contacts_deleted === 0 && r.mail_sends_redacted === 0 && r.broadcast_sends_redacted === 0) {
      toast.info(`No records found for ${target}`);
    } else {
      toast.success(`Erased ${target}`);
    }
    setEmail("");
    router.refresh();
  }

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <ShieldX className="h-4 w-4 text-red-300" /> Erase a person&apos;s data
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          For a GDPR/CCPA erasure request. Removes every contact row for that address across all
          your campaigns, and redacts the address from your send history. The leads are your
          responsibility as the data controller — this is the tool for honouring that.
        </p>
      </div>

      <form onSubmit={erase} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
          className="w-72 max-w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
        />
        <Button type="submit" disabled={busy || !email.trim()} variant="outline" className="text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldX className="h-3.5 w-3.5" />}
          Erase
        </Button>
      </form>

      {result && (
        <p className="text-xs text-zinc-400">
          {result.contacts_deleted} contact{result.contacts_deleted === 1 ? "" : "s"} deleted ·{" "}
          {result.mail_sends_redacted + result.broadcast_sends_redacted} send record
          {result.mail_sends_redacted + result.broadcast_sends_redacted === 1 ? "" : "s"} redacted
        </p>
      )}
    </section>
  );
}
