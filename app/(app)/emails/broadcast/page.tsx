import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BroadcastComposer from "@/components/BroadcastComposer";

export const dynamic = "force-dynamic";

// Emails → Broadcast: compose one email and send it now to a chosen audience. Under the hood a
// broadcast is a `kind='broadcast'` sequence with a single delay_days=0 step (0035), so every
// guarantee the drip feature already has — pooled daily send cap, unsubscribe footer,
// broadcast_sends auditing, per-send failure handling — applies here for free.
export default async function BroadcastPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  const [{ data: campaigns }, { data: sent }, { data: provider }, { data: contactRows }] = await Promise.all([
    supabase.from("campaigns").select("id, products(product_title)"),
    supabase
      .from("broadcast_sequences")
      .select("id, name, status, audience_type, created_at")
      .eq("workspace_id", ws)
      .eq("kind", "broadcast")
      .eq("channel", "email")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("workspaces").select("active_mail_provider").eq("id", ws).maybeSingle(),
    // Manual send needs the real recipient list client-side (mailto/copy happen in the browser).
    // Capped for the same reason /contacts is: a busy funnel can accumulate these fast.
    supabase
      .from("contacts")
      .select("id, email, first_name, campaign_id")
      .eq("workspace_id", ws)
      .is("unsubscribed_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const campaignOptions = (campaigns ?? [])
    .map((c) => ({ id: c.id as string, title: ((c as any).products?.product_title as string) ?? "Untitled campaign" }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Counts per broadcast, so the history list can show how many actually went out.
  const { data: sendRows } = await supabase.from("broadcast_sends").select("sequence_id").eq("workspace_id", ws);
  const sentCount = new Map<string, number>();
  for (const r of sendRows ?? []) {
    if (r.sequence_id) sentCount.set(r.sequence_id, (sentCount.get(r.sequence_id) ?? 0) + 1);
  }

  return (
    <BroadcastComposer
      campaigns={campaignOptions}
      history={(sent ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        status: s.status as string,
        audience_type: s.audience_type as string,
        created_at: s.created_at as string,
        sent_count: sentCount.get(s.id as string) ?? 0,
      }))}
      activeProvider={(provider?.active_mail_provider as string) ?? null}
      contacts={(contactRows ?? []).map((c) => ({
        id: c.id as string,
        email: c.email as string,
        first_name: (c.first_name as string) ?? null,
        campaign_id: (c.campaign_id as string) ?? null,
      }))}
    />
  );
}
