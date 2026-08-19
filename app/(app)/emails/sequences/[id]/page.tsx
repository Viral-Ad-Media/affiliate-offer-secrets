"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastSequence, BroadcastStep, Contact } from "@/lib/shared";
import BroadcastSequenceForm from "@/components/BroadcastSequenceForm";
import BroadcastStepsEditor from "@/components/BroadcastStepsEditor";
import BroadcastContactPicker from "@/components/BroadcastContactPicker";
import BroadcastActivateControl from "@/components/BroadcastActivateControl";

type Stats = { enrolled: number; pending: number; queued: number; sent: number; failed: number; skipped: number };

export default function BroadcastSequencePage({ params }: { params: { id: string } }) {
  const [sequence, setSequence] = useState<BroadcastSequence | null>(null);
  const [steps, setSteps] = useState<BroadcastStep[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<{ id: string; title: string }[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({ enrolled: 0, pending: 0, queued: 0, sent: 0, failed: 0, skipped: 0 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: seq }, { data: stepRows }, { data: contactRows }, { data: campaigns }, { data: manualRows }] =
      await Promise.all([
        supabase.from("broadcast_sequences").select("*").eq("id", params.id).maybeSingle(),
        supabase
          .from("broadcast_steps")
          .select("id, sequence_id, step_index, delay_days, subject, body_md")
          .eq("sequence_id", params.id)
          .order("step_index", { ascending: true }),
        supabase
          .from("contacts")
          .select("id, campaign_id, first_name, email, extra_fields, created_at, unsubscribed_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("campaigns").select("id, products(product_title)"),
        supabase.from("broadcast_sequence_contacts").select("contact_id").eq("sequence_id", params.id),
      ]);

    if (!seq) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const titleByCampaign = new Map<string, string>();
    for (const c of campaigns ?? []) {
      const title = (c as any).products?.product_title;
      if (title) titleByCampaign.set(c.id, title);
    }

    setSequence(seq as BroadcastSequence);
    setSteps((stepRows ?? []) as BroadcastStep[]);
    setContacts(
      (contactRows ?? []).map((r: any) => ({
        id: r.id,
        campaign_id: r.campaign_id,
        campaign_title: r.campaign_id ? (titleByCampaign.get(r.campaign_id) ?? null) : null,
        last_name: r.last_name ?? null,
        first_name: r.first_name,
        email: r.email,
        extra_fields: r.extra_fields ?? {},
        created_at: r.created_at,
        unsubscribed_at: r.unsubscribed_at ?? null,
        // The manual-audience picker only needs identity to choose rows; it never renders tags, so
        // they're deliberately not fetched here rather than paying for a join this screen ignores.
        tags: [],
      }))
    );
    setCampaignOptions(
      (campaigns ?? [])
        .filter((c: any) => c.products?.product_title)
        .map((c: any) => ({ id: c.id, title: c.products.product_title as string }))
    );
    setSelectedContactIds((manualRows ?? []).map((r) => r.contact_id));

    const { data: enrollments } = await supabase
      .from("broadcast_enrollments")
      .select("id")
      .eq("sequence_id", params.id);
    const { data: enrollmentSteps } = await supabase
      .from("broadcast_enrollment_steps")
      .select("status, enrollment_id")
      .in("enrollment_id", (enrollments ?? []).map((e) => e.id).length > 0 ? (enrollments ?? []).map((e) => e.id) : ["00000000-0000-0000-0000-000000000000"]);
    const counts: Stats = { enrolled: enrollments?.length ?? 0, pending: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
    for (const s of enrollmentSteps ?? []) {
      if (s.status in counts) (counts as any)[s.status]++;
    }
    setStats(counts);

    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (notFound || !sequence) {
    return (
      <main className="space-y-4">
        <Link href="/emails/sequences" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Broadcast
        </Link>
        <p className="text-sm text-zinc-500">Sequence not found.</p>
      </main>
    );
  }

  const editable = sequence.status === "draft";
  const stepsEditable = sequence.status === "draft" || sequence.status === "paused";

  return (
    <main className="space-y-5">
      <Link href="/emails/sequences" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Back to Broadcast
      </Link>

      <BroadcastSequenceForm sequence={sequence} campaignOptions={campaignOptions} editable={editable} onSaved={load} />

      <BroadcastActivateControl sequence={sequence} stepCount={steps.length} selectedContactCount={selectedContactIds.length} stats={stats} onChanged={load} />

      <BroadcastStepsEditor
        sequenceId={sequence.id}
        steps={steps}
        editable={stepsEditable}
        channel={(sequence as { channel?: "email" | "sms" }).channel ?? "email"}
        onChanged={load}
      />

      {sequence.audience_type === "manual" && (
        <BroadcastContactPicker
          sequenceId={sequence.id}
          contacts={contacts}
          selectedIds={selectedContactIds}
          editable={editable}
          onSaved={load}
        />
      )}
    </main>
  );
}
