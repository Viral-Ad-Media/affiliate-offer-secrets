import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BroadcastSequence } from "@/lib/shared";
import BroadcastSequenceList from "@/components/BroadcastSequenceList";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

export default async function BroadcastPage({ searchParams }: { searchParams: { page?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("broadcast_sequences")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", "sequence");
  const total = count ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const [from, to] = pageRange(page);

  const [{ data: sequences }, { data: campaigns }, { data: steps }, { data: enrollments }] = await Promise.all([
    supabase
      .from("broadcast_sequences")
      .select("id, name, audience_type, campaign_id, status, created_at, updated_at")
      .eq("user_id", user.id)
      // Only multi-step drips — one-off sends (kind='broadcast', 0035) have their own page.
      .eq("kind", "sequence")
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase.from("campaigns").select("id, products(product_title)"),
    supabase.from("broadcast_steps").select("id, sequence_id").eq("user_id", user.id),
    supabase.from("broadcast_enrollments").select("id, sequence_id").eq("user_id", user.id),
  ]);

  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id, title);
  }

  const stepCountBySequence = new Map<string, number>();
  for (const s of steps ?? []) {
    stepCountBySequence.set(s.sequence_id, (stepCountBySequence.get(s.sequence_id) ?? 0) + 1);
  }
  const enrolledCountBySequence = new Map<string, number>();
  for (const e of enrollments ?? []) {
    enrolledCountBySequence.set(e.sequence_id, (enrolledCountBySequence.get(e.sequence_id) ?? 0) + 1);
  }

  const rows = (sequences ?? []).map((s: BroadcastSequence) => ({
    sequence: s,
    campaignTitle: s.campaign_id ? (titleByCampaign.get(s.campaign_id) ?? null) : null,
    stepCount: stepCountBySequence.get(s.id) ?? 0,
    enrolledCount: enrolledCountBySequence.get(s.id) ?? 0,
  }));

  const campaignOptions = (campaigns ?? [])
    .filter((c: any) => c.products?.product_title)
    .map((c: any) => ({ id: c.id, title: c.products.product_title as string }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Sequences</h1>
        <p className="text-sm text-zinc-400">
          Automated drip sequences — each step fires a set number of days after that contact&apos;s
          own signup. For a single email sent now, use Broadcast.
        </p>
      </header>
      <BroadcastSequenceList rows={rows} campaignOptions={campaignOptions} />
      <Pager page={page} total={total} basePath="/emails/sequences" label="sequences" />
    </main>
  );
}
