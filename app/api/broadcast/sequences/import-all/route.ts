import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseEmailSwipe, defaultDelayDays } from "@/lib/engine/emailSwipe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Turns every campaign kit's generated email swipe (campaigns.email_md) into a real drip sequence
// the tenant can edit and activate.
//
// Created as DRAFT, never activated: activating enrols contacts and starts sending real email to
// real people. That has to be a deliberate act by the tenant, not a side effect of an import.
//
// Writes go through the existing create_broadcast_sequence / upsert_broadcast_step RPCs on the
// RLS-scoped client, so ownership is enforced by the same code path the UI uses — no admin client
// and no second implementation of those rules.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const [{ data: campaigns }, { data: existing }] = await Promise.all([
    // A campaign that errored mid-build can still hold a finished swipe (the social stage runs
    // before the ones that failed), so the filter is "has a swipe", not "status = ready".
    supabase
      .from("campaigns")
      .select("id, products(product_title)")
      .not("email_md", "is", null)
      .order("created_at"),
    // One sequence per campaign — re-running this must not stack up duplicates.
    supabase.from("broadcast_sequences").select("campaign_id").eq("kind", "sequence"),
  ]);

  const alreadyImported = new Set((existing ?? []).map((s) => s.campaign_id).filter(Boolean));

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const c of campaigns ?? []) {
    const campaignId = c.id as string;
    if (alreadyImported.has(campaignId)) {
      skipped++;
      continue;
    }
    try {
      // email_md isn't in the list select above — fetch per campaign so a tenant with many kits
      // doesn't pull every swipe's full text into one response.
      const { data: full } = await supabase
        .from("campaigns")
        .select("email_md")
        .eq("id", campaignId)
        .maybeSingle();
      const emails = parseEmailSwipe(full?.email_md as string | null);
      if (emails.length === 0) {
        skipped++;
        continue;
      }

      const productTitle =
        (c.products as unknown as { product_title: string } | null)?.product_title ?? "Campaign";
      const { data: sequenceId, error: seqErr } = await supabase.rpc("create_broadcast_sequence", {
        p_name: `${productTitle} — email swipe`,
        // The campaign's own contacts are the natural audience for its swipe; the tenant can widen
        // it in the editor before activating.
        p_audience_type: "campaign",
        p_campaign_id: campaignId,
        p_kind: "sequence",
      });
      if (seqErr || !sequenceId) throw new Error(seqErr?.message ?? "could not create sequence");

      for (let i = 0; i < emails.length; i++) {
        const { error: stepErr } = await supabase.rpc("upsert_broadcast_step", {
          p_sequence_id: sequenceId,
          p_step_index: i,
          p_delay_days: defaultDelayDays(i),
          p_subject: emails[i].subject,
          p_body_md: emails[i].body_md,
        });
        if (stepErr) throw new Error(stepErr.message);
      }
      created++;
    } catch (err: any) {
      // One bad kit shouldn't abandon the rest of the import.
      failed.push(campaignId);
      console.error("sequence import failed for campaign", campaignId, err);
    }
  }

  return NextResponse.json({ ok: true, created, skipped, failed: failed.length });
}
