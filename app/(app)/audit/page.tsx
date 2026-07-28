import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuditEntry, UsageEntry } from "@/lib/shared";
import AuditTrail from "@/components/AuditTrail";
import UsageLedger from "@/components/UsageLedger";

function truncate(text: string | null, max = 80): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default async function AuditPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: meta }, { data: instagram }, { data: tiktok }, { data: youtube }, { data: mail }, { data: campaigns }, { data: usageRows }] =
    await Promise.all([
      supabase.from("meta_posts").select("*").eq("user_id", user.id),
      supabase.from("instagram_posts").select("*").eq("user_id", user.id),
      supabase.from("tiktok_posts").select("*").eq("user_id", user.id),
      supabase.from("youtube_posts").select("*").eq("user_id", user.id),
      supabase.from("mail_sends").select("*").eq("user_id", user.id),
      supabase.from("campaigns").select("id, products(product_title)"),
      supabase.from("usage_ledger").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);

  const usage = (usageRows ?? []) as UsageEntry[];
  const totalCostUsd = usage.reduce((sum, u) => sum + u.cost_usd, 0);

  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id, title);
  }

  const entries: AuditEntry[] = [
    ...(meta ?? []).map((p: any): AuditEntry => ({
      id: p.id,
      platform: "facebook",
      created_at: p.created_at,
      campaign_id: p.campaign_id,
      campaign_title: p.campaign_id ? (titleByCampaign.get(p.campaign_id) ?? null) : null,
      summary: truncate(p.message) || "Posted to Page",
      detail: `Page ${p.page_id}`,
      externalUrl: p.fb_post_id ? `https://www.facebook.com/${p.fb_post_id}` : null,
    })),
    ...(instagram ?? []).map((p: any): AuditEntry => ({
      id: p.id,
      platform: "instagram",
      created_at: p.created_at,
      campaign_id: p.campaign_id,
      campaign_title: p.campaign_id ? (titleByCampaign.get(p.campaign_id) ?? null) : null,
      summary: truncate(p.caption) || "Posted a Reel",
      detail: null,
      externalUrl: null,
    })),
    ...(tiktok ?? []).map((p: any): AuditEntry => ({
      id: p.id,
      platform: "tiktok",
      created_at: p.created_at,
      campaign_id: p.campaign_id,
      campaign_title: p.campaign_id ? (titleByCampaign.get(p.campaign_id) ?? null) : null,
      summary: truncate(p.caption) || "Posted a video",
      detail: null,
      externalUrl: null,
    })),
    ...(youtube ?? []).map((p: any): AuditEntry => ({
      id: p.id,
      platform: "youtube",
      created_at: p.created_at,
      campaign_id: p.campaign_id,
      campaign_title: p.campaign_id ? (titleByCampaign.get(p.campaign_id) ?? null) : null,
      summary: truncate(p.title) || "Uploaded a video",
      detail: null,
      externalUrl: p.youtube_video_id ? `https://www.youtube.com/watch?v=${p.youtube_video_id}` : null,
    })),
    ...(mail ?? []).map((p: any): AuditEntry => ({
      id: p.id,
      platform: "mail",
      created_at: p.created_at,
      campaign_id: p.campaign_id,
      campaign_title: p.campaign_id ? (titleByCampaign.get(p.campaign_id) ?? null) : null,
      summary: truncate(p.subject) || "Sent an email",
      detail: `to ${p.to_address}`,
      externalUrl: null,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Audit trail</h1>
        <p className="text-sm text-zinc-400">
          A record of every real post, upload, or email this app has sent on your connected
          accounts.
        </p>
      </header>
      <AuditTrail entries={entries} />
      {usage.length > 0 && <UsageLedger entries={usage} totalCostUsd={totalCostUsd} />}
    </main>
  );
}
