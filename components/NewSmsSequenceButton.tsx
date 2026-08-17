"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Creates a draft SMS drip and opens it.
 *
 * Goes through the same create_broadcast_sequence RPC email uses, with channel='sms' — the RPC is
 * where audience ownership is checked (assert_owns_campaign), so a second creation path would be a
 * second place to get that wrong.
 *
 * Audience is 'all' here rather than offering a picker: for SMS "all" already means "everyone who
 * gave SMS consent and hasn't opted out" (enrollment filters on channel, 0098), which is the only
 * audience that makes sense as a default. Narrowing to one campaign is done on the detail page,
 * where the audience control already lives for email.
 */
export default function NewSmsSequenceButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc("create_broadcast_sequence", {
      p_name: "New SMS sequence",
      p_audience_type: "all",
      p_campaign_id: null,
      p_kind: "sequence",
      p_channel: "sms",
    });
    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Could not create the sequence");
      return;
    }
    // The detail page lives under /emails/sequences because it edits broadcast_sequences rows,
    // whatever their channel — one editor, now channel-aware, rather than a second copy.
    router.push(`/emails/sequences/${data}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={create} disabled={busy || disabled}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New SMS sequence
      </Button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}
