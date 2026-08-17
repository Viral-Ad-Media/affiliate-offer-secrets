// Everything the Overview page needs to answer "what should I do right now", computed in one
// place so the page stays a thin renderer.
//
// SERVER-ONLY (takes a Supabase client). Every query is workspace-scoped explicitly on top of RLS —
// the standing belt-and-braces rule: the policy decides whether a row is visible at all, the filter
// decides which of YOUR workspaces you are looking at.
//
// Counts use head:true wherever the rows themselves aren't needed, because this runs on every
// dashboard load and the campaigns table averages ~166 kB per row.

import type { SupabaseClient } from "@supabase/supabase-js";
import { MIN_VISITORS_PER_ARM, MIN_CONVERSIONS_TOTAL } from "@/lib/splitTestStats";

/** How far back a failed job still counts as something to act on. */
export const FAILED_JOB_WINDOW_DAYS = 7;

export type AttentionItem = {
  key: string;
  /** What is waiting, in the operator's words. */
  label: string;
  /** Why it matters / what happens next. One line. */
  detail: string;
  count: number;
  href: string;
  /** `warn` = something is failing or stuck; `todo` = work sitting finished-but-unshipped. */
  tone: "warn" | "todo";
};

/**
 * The action queue: finished work that hasn't shipped, plus things that are actually broken.
 *
 * This exists because generated work was invisible until you went looking — 40 ad angles and 14
 * email sequences sat ready with nothing saying so, and two terminally-failed video jobs were
 * only discoverable through SQL. Every entry is DERIVED from live counts, never a stored flag:
 * a flag would keep claiming work is outstanding after it shipped, and every write path would
 * have to remember to clear it. Same reasoning as SetupChecklist.
 *
 * An item with a zero count is dropped entirely rather than rendered as "0 waiting" — a queue
 * should only contain things you could act on.
 */
export async function getAttentionItems(
  supabase: SupabaseClient,
  ws: string
): Promise<AttentionItem[]> {
  const head = { count: "exact" as const, head: true };

  const [
    unpublishedFunnels,
    failedJobs,
    pendingDomains,
    draftSequences,
    failedCreatives,
    draftPosts,
    launchesAwaitingReview,
    { data: variantRows },
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id", head)
      .eq("workspace_id", ws)
      .eq("bridge_published", false)
      .not("bridge_html", "is", null),
    // Terminal failures only — a job with retries left may still succeed on its own, and listing
    // it would be asking someone to act on something that is still working.
    //
    // And RECENT ones only. All-time this workspace has 22, nearly all long dealt with; a queue
    // that permanently reads "22 jobs failed" is one you learn to scroll past, which costs the
    // genuinely-new failure the attention the panel exists to give it. Same reasoning as
    // suppressing the "ads without a funnel" warning where that state is normal.
    supabase
      .from("jobs")
      .select("id", head)
      .eq("workspace_id", ws)
      .eq("status", "error")
      .gte("updated_at", new Date(Date.now() - FAILED_JOB_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from("custom_domains").select("id", head).eq("workspace_id", ws).neq("status", "verified"),
    supabase
      .from("broadcast_sequences")
      .select("id", head)
      .eq("workspace_id", ws)
      .eq("status", "draft"),
    supabase.from("campaign_creatives").select("id", head).eq("workspace_id", ws).eq("status", "failed"),
    supabase.from("blog_posts").select("id", head).eq("workspace_id", ws).eq("status", "draft"),
    supabase.from("ad_launches").select("id", head).eq("workspace_id", ws).eq("status", "paused_review"),
    // Split tests with enough data to call. Read rather than counted: "enough" is a per-campaign
    // judgement across both arms, not a row filter.
    supabase
      .from("bridge_variants")
      .select("campaign_id, views, leads, status")
      .eq("workspace_id", ws)
      .eq("status", "active"),
  ]);

  // A test is decidable on exactly the gate VariantConfidence already uses — the THINNER arm past
  // MIN_VISITORS_PER_ARM and MIN_CONVERSIONS_TOTAL across both. Reusing those constants rather
  // than picking a number here is what stops the dashboard inviting a decision the split-test
  // panel would then refuse to show a percentage for.
  const byCampaign = new Map<string, { views: number[]; leads: number }>();
  for (const v of variantRows ?? []) {
    const id = v.campaign_id as string;
    const entry = byCampaign.get(id) ?? { views: [], leads: 0 };
    entry.views.push(Number(v.views ?? 0));
    entry.leads += Number(v.leads ?? 0);
    byCampaign.set(id, entry);
  }
  const decidableTests = Array.from(byCampaign.values()).filter(
    (e) => e.views.length >= 2 && Math.min(...e.views) >= MIN_VISITORS_PER_ARM && e.leads >= MIN_CONVERSIONS_TOTAL
  ).length;

  const items: AttentionItem[] = [
    {
      key: "split-tests",
      label: "Split tests ready to call",
      detail: "Enough traffic to judge — promote a winner and stop splitting.",
      count: decidableTests,
      href: "/funnels",
      tone: "todo",
    },
    {
      key: "failed-jobs",
      label: `Generation jobs failed in ${FAILED_JOB_WINDOW_DAYS} days`,
      detail: "Out of retries — check the error and requeue.",
      count: failedJobs.count ?? 0,
      href: "/settings/jobs",
      tone: "warn",
    },
    {
      key: "failed-creatives",
      label: "Creatives failed to generate",
      detail: "An image or video didn't finish. Try again, or a different model.",
      count: failedCreatives.count ?? 0,
      href: "/products",
      tone: "warn",
    },
    {
      key: "pending-domains",
      label: "Domains not verified",
      detail: "DNS isn't pointing here yet, so pages on them won't serve.",
      count: pendingDomains.count ?? 0,
      href: "/settings/domains",
      tone: "warn",
    },
    {
      key: "ads-review",
      label: "Ads paused for review",
      detail: "Created at Meta and waiting on you to activate — they aren't spending yet.",
      count: launchesAwaitingReview.count ?? 0,
      href: "/ads",
      tone: "todo",
    },
    {
      key: "unpublished-funnels",
      label: "Funnels built but unpublished",
      detail: "Ready to take traffic — they 404 until published.",
      count: unpublishedFunnels.count ?? 0,
      href: "/funnels",
      tone: "todo",
    },
    {
      key: "draft-sequences",
      label: "Email sequences in draft",
      detail: "Generated from a kit. Nothing sends until one is activated.",
      count: draftSequences.count ?? 0,
      href: "/emails/sequences",
      tone: "todo",
    },
    {
      key: "draft-posts",
      label: "Blog posts in draft",
      detail: "Written with a kit. Publish to make them crawlable.",
      count: draftPosts.count ?? 0,
      href: "/blog/posts",
      tone: "todo",
    },
  ];

  // Problems first, then the biggest pile of unshipped work.
  return items
    .filter((i) => i.count > 0)
    .sort((a, b) => (a.tone === b.tone ? b.count - a.count : a.tone === "warn" ? -1 : 1));
}

export type CreditRunway = {
  balance: number;
  spent30d: number;
  /** Whole kits affordable at the current build price. Null when nothing has been spent yet. */
  kitsAffordable: number | null;
  /** Days of runway at the last 30 days' burn rate. Null when burn is zero. */
  daysLeft: number | null;
};

/**
 * Balance plus what it actually buys.
 *
 * A bare number can't be acted on — the useful question is "how many more kits is that", which
 * needs the price list (lib/credits.ts) and recent burn. Burn is measured over 30 days rather than
 * all time so a heavy first week doesn't permanently distort the estimate.
 */
export async function getCreditRunway(
  supabase: SupabaseClient,
  ws: string,
  buildCost: number
): Promise<CreditRunway> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: all }, { data: recent }] = await Promise.all([
    supabase.from("credits_ledger").select("delta").eq("workspace_id", ws),
    supabase.from("credits_ledger").select("delta").eq("workspace_id", ws).gte("created_at", since).lt("delta", 0),
  ]);

  const balance = (all ?? []).reduce((s, r) => s + Number(r.delta ?? 0), 0);
  const spent30d = Math.abs((recent ?? []).reduce((s, r) => s + Number(r.delta ?? 0), 0));
  const perDay = spent30d / 30;

  return {
    balance,
    spent30d,
    kitsAffordable: buildCost > 0 ? Math.floor(balance / buildCost) : null,
    daysLeft: perDay > 0 ? Math.floor(balance / perDay) : null,
  };
}

export type LeadPoint = { day: string; count: number };

/**
 * Leads per day for the last 30 days, zero-filled.
 *
 * Zero-filling matters: without it a sparkline silently compresses quiet days out of existence and
 * draws a busier picture than reality. Reads `created_at` only — the rows themselves are never
 * needed, and contacts can accumulate fast from real paid traffic.
 */
export async function getLeadTrend(supabase: SupabaseClient, ws: string): Promise<LeadPoint[]> {
  const days = 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { data } = await supabase
    .from("contacts")
    .select("created_at")
    .eq("workspace_id", ws)
    .gte("created_at", since.toISOString())
    .order("created_at");

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of data ?? []) {
    const key = String(r.created_at).slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets, ([day, count]) => ({ day, count }));
}

export type FunnelPerformance = {
  campaignId: string;
  title: string;
  views: number;
  leads: number;
  rate: number | null;
};

/**
 * Best-converting published funnels, from the existing funnel_stats view plus variant views.
 *
 * Rate is NULL below MIN_VIEWS rather than computed: 1 lead from 2 views is 50%, which is noise
 * presented as a result — the same trap the split-test confidence gate exists to prevent. A funnel
 * with no bridge_variants rows has no view counter at all (views are recorded per variant), so it
 * reports leads with no rate rather than a fabricated one.
 */
export const MIN_VIEWS_FOR_RATE = 30;

export async function getTopFunnels(
  supabase: SupabaseClient,
  ws: string,
  limit = 5
): Promise<FunnelPerformance[]> {
  const [{ data: stats }, { data: variants }] = await Promise.all([
    supabase.from("funnel_stats").select("campaign_id, leads").eq("workspace_id", ws),
    supabase.from("bridge_variants").select("campaign_id, views").eq("workspace_id", ws),
  ]);
  if (!stats?.length) return [];

  const viewsByCampaign = new Map<string, number>();
  for (const v of variants ?? []) {
    const id = v.campaign_id as string;
    viewsByCampaign.set(id, (viewsByCampaign.get(id) ?? 0) + Number(v.views ?? 0));
  }

  const withLeads = stats.filter((s) => Number(s.leads ?? 0) > 0);
  if (!withLeads.length) return [];

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, products(product_title)")
    .eq("workspace_id", ws)
    .in("id", withLeads.map((s) => s.campaign_id as string));

  const titleById = new Map(
    (campaigns ?? []).map((c: any) => [
      c.id as string,
      (c.products?.product_title as string | undefined) ?? (c.name as string | null) ?? "Untitled",
    ])
  );

  return withLeads
    .map((s) => {
      const id = s.campaign_id as string;
      const leads = Number(s.leads ?? 0);
      const views = viewsByCampaign.get(id) ?? 0;
      return {
        campaignId: id,
        title: titleById.get(id) ?? "Untitled",
        views,
        leads,
        rate: views >= MIN_VIEWS_FOR_RATE ? (leads / views) * 100 : null,
      };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.leads - a.leads)
    .slice(0, limit);
}
