import { redirect } from "next/navigation";
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

  const [{ data: campaigns }, { data: sent }, { data: mail }, { data: provider }] = await Promise.all([
    supabase.from("campaigns").select("id, products(product_title)"),
    supabase
      .from("broadcast_sequences")
      .select("id, name, status, audience_type, created_at")
      .eq("user_id", user.id)
      .eq("kind", "broadcast")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("mail_connections").select("email_address, status").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("active_mail_provider").eq("id", user.id).maybeSingle(),
  ]);

  const campaignOptions = (campaigns ?? [])
    .map((c) => ({ id: c.id as string, title: ((c as any).products?.product_title as string) ?? "Untitled campaign" }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Counts per broadcast, so the history list can show how many actually went out.
  const { data: sendRows } = await supabase.from("broadcast_sends").select("sequence_id").eq("user_id", user.id);
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
      senderEmail={(mail?.email_address as string) ?? null}
      senderStatus={(mail?.status as string) ?? null}
      activeProvider={(provider?.active_mail_provider as string) ?? "gmail"}
    />
  );
}
