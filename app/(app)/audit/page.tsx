import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import type { AuditEntry, AuditPlatform, UsageEntry } from "@/lib/shared";
import AuditTrail from "@/components/AuditTrail";
import UsageLedger from "@/components/UsageLedger";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

export const dynamic = "force-dynamic";

// One counted, ordered, ranged query against the audit_events view (0049) — which UNIONs the six
// tables this page used to fetch separately and merge in JS. That old shape read up to 200 rows
// from each of six tables on every load and threw most of them away; worse, it could only ever
// show the newest 200, so older activity was permanently unreachable. Now the page number lives in
// the URL and each page is its own query.
//
// The usage ledger below it is a separate table with its own volume, so it gets its own page param
// (?usage=) — paging one must not reset the other.

function truncate(text: string | null, max = 80): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const DEFAULT_SUMMARY: Record<string, string> = {
  facebook: "Posted to Page",
  instagram: "Posted a Reel",
  tiktok: "Posted a video",
  youtube: "Uploaded a video",
  mail: "Sent an email",
  broadcast: "Sent a broadcast email",
};

// External links are built here rather than in the view: the id a platform stores and the URL a
// human clicks are different things, and a database view is the wrong place to hardcode someone
// else's URL structure.
function externalUrl(platform: string, externalId: string | null): string | null {
  if (!externalId) return null;
  if (platform === "facebook") return `https://www.facebook.com/${externalId}`;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${externalId}`;
  return null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { page?: string; usage?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  // Counts first: the page number can't be clamped to a real range without knowing the totals, and
  // head:true means neither count pulls a single row.
  const [{ count: eventTotal }, { count: usageTotal }] = await Promise.all([
    supabase.from("audit_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase.from("usage_ledger").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const total = eventTotal ?? 0;
  const usageCount = usageTotal ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const usagePage = pageFromParam(searchParams.usage, Math.ceil(usageCount / PAGE_SIZE));
  const [from, to] = pageRange(page);
  const [usageFrom, usageTo] = pageRange(usagePage);

  const [{ data: events }, { data: usageRows }] = await Promise.all([
    supabase
      .from("audit_events")
      .select("id, platform, created_at, campaign_id, summary, detail, external_id")
      .eq("workspace_id", ws)
      // id as a tiebreaker: created_at alone isn't unique across six tables, and a non-deterministic
      // sort makes rows appear twice (or not at all) as you page through them.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
    supabase
      .from("usage_ledger")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(usageFrom, usageTo),
  ]);

  // Campaign titles only for the campaigns actually on this page — the old version fetched every
  // campaign the tenant owns on every load.
  const campaignIds = Array.from(
    new Set((events ?? []).map((e: any) => e.campaign_id).filter(Boolean))
  ) as string[];
  const titleByCampaign = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, products(product_title)")
      .in("id", campaignIds);
    for (const c of campaigns ?? []) {
      const title = (c as any).products?.product_title;
      if (title) titleByCampaign.set(c.id as string, title);
    }
  }

  const entries: AuditEntry[] = (events ?? []).map((e: any): AuditEntry => ({
    id: e.id,
    platform: e.platform as AuditPlatform,
    created_at: e.created_at,
    campaign_id: e.campaign_id,
    campaign_title: e.campaign_id ? (titleByCampaign.get(e.campaign_id) ?? null) : null,
    summary: truncate(e.summary) || DEFAULT_SUMMARY[e.platform] || "Activity",
    detail: e.detail ?? null,
    externalUrl: externalUrl(e.platform, e.external_id),
  }));

  const usage = (usageRows ?? []) as UsageEntry[];
  // This page's own total, not a lifetime one — adding a second aggregate query for a figure the
  // Billing page already covers isn't worth the round trip.
  const totalCostUsd = usage.reduce((sum, u) => sum + u.cost_usd, 0);

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
      <Pager
        page={page}
        total={total}
        basePath="/audit"
        label="events"
        preserve={{ usage: searchParams.usage }}
      />
      {usageCount > 0 && (
        <>
          <UsageLedger entries={usage} totalCostUsd={totalCostUsd} />
          <Pager
            page={usagePage}
            total={usageCount}
            basePath="/audit"
            label="generation calls"
            paramName="usage"
          />
        </>
      )}
    </main>
  );
}
