import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { originFromHost } from "@/lib/host";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";
import NewFunnelButton from "@/components/NewFunnelButton";
import LoadFailed from "@/components/LoadFailed";
import { Inbox, Archive } from "lucide-react";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/EmptyState";
import FunnelsTable from "@/components/FunnelsTable";

// A "funnel" isn't its own entity — it's a derived view over campaigns that already have a bridge
// (lead-capture) page generated. A funnel appears here automatically the moment stagePages
// (lib/engine/build.ts) writes campaigns.bridge_html; there's nothing to explicitly create or keep
// in sync. Editing/publishing/split-testing/adding steps all happen on the funnel's own
// /funnels/[campaignId] page — this list page is read-only, not a second place that writes state.
// The product page's Bridge tab is preview-only, linking here to actually manage anything.
export default async function FunnelsPage({ searchParams }: { searchParams?: { archived?: string } }) {
  const showingArchived = searchParams?.archived === "1";
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Explicit workspace filter on top of RLS — the standing belt-and-braces rule. This page had
  // none at all, so a member of two workspaces saw both workspaces' funnels merged into one list.
  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  // The MAIN list query's error is captured, not discarded. A failed query rendering the ordinary
  // empty state is how the Domains page hid a broken embed for weeks (see components/LoadFailed) —
  // an empty state is a claim about the data, and a failed query can't support it.
  const [{ data: campaigns, error: campaignsError }, { data: routes }, { data: statRows }] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, product_id, name, bridge_published, archived_at, updated_at, products(product_title)")
        .eq("workspace_id", ws)
        .not("bridge_html", "is", null)
        // Archived funnels are hidden by default rather than deleted — the whole point of the
        // action. `is`, not `eq`: PostgREST needs the null test, and eq("archived_at", null) would
        // send the string "null" at a timestamptz.
        .filter("archived_at", showingArchived ? "not.is" : "is", null)
        .order("updated_at", { ascending: false }),
      supabase
        .from("custom_domain_routes")
        // FK hint required since 0088 added a second FK between these tables — unhinted, PostgREST
        // answers PGRST201 and the branded links silently vanish. See settings/domains/page.tsx.
        .select("campaign_id, path, custom_domains!custom_domain_routes_domain_id_fkey(domain, status)")
        .eq("workspace_id", ws)
        .eq("destination", "bridge"),
      // One aggregate instead of three fetch-alls grouped in JS (0079). The old version pulled
      // every contact — capped at 1000 — plus every variant and step row for the whole workspace
      // to render three numbers per row. Past a thousand leads that cap made the counts silently
      // WRONG, not just slow, which is the worse half of the bug.
      supabase.from("funnel_stats").select("campaign_id, leads, variants, steps").eq("workspace_id", ws),
    ]);

  const leadCounts = new Map<string, number>();
  const variantCounts = new Map<string, number>();
  const stepCounts = new Map<string, number>();
  for (const r of statRows ?? []) {
    const id = r.campaign_id as string;
    leadCounts.set(id, Number(r.leads ?? 0));
    variantCounts.set(id, Number(r.variants ?? 0));
    stepCounts.set(id, Number(r.steps ?? 0));
  }

  // First verified custom-domain route wins if a campaign has more than one — same "just show one
  // representative link" simplification PublishBridge.tsx's own summary already makes.
  const domainUrlByCampaign = new Map<string, string>();
  for (const r of (routes ?? []) as any[]) {
    if (r.custom_domains?.status !== "verified") continue;
    if (domainUrlByCampaign.has(r.campaign_id)) continue;
    domainUrlByCampaign.set(r.campaign_id, `https://${r.custom_domains.domain}/${r.path}`);
  }

  // The host that served this page, not NEXT_PUBLIC_APP_URL — since the canonical redirect the
  // operator is on their workspace subdomain, and the default link shown should be the branded one.
  const appUrl = originFromHost(headers().get("host")) || (process.env.NEXT_PUBLIC_APP_URL ?? "");

  const funnels = (campaigns ?? []).map((c: any) => ({
    id: c.id as string,
    productId: c.product_id as string | null,
    // A hand-built funnel has no product to borrow a title from, so it carries its own name.
    title: (c.products?.product_title as string | undefined) ?? (c.name as string | null) ?? "Untitled",
    published: c.bridge_published as boolean,
    leads: leadCounts.get(c.id) ?? 0,
    url: domainUrlByCampaign.get(c.id) ?? `${appUrl}/p/${c.id}/bridge`,
    variantCount: variantCounts.get(c.id) ?? 0,
    stepCount: stepCounts.get(c.id) ?? 0,
    archived: !!c.archived_at,
  }));

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Funnels</h1>
          <p className="text-sm text-zinc-400">
            Every lead-capture page your offers have. One appears here automatically when a campaign
            kit finishes building — or build one by hand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* A plain link, not a client toggle: it is a different list, so it deserves a URL that
              can be bookmarked and a back button that works. */}
          <Link
            href={showingArchived ? "/funnels" : "/funnels?archived=1"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300"
          >
            <Archive className="h-3.5 w-3.5" />
            {showingArchived ? "Active funnels" : "Archived"}
          </Link>
          <NewFunnelButton />
        </div>
      </header>

      <Card as="section" className="overflow-hidden">
        {campaignsError ? (
          <div className="p-4">
            <LoadFailed what="your funnels" detail={campaignsError.message} />
          </div>
        ) : funnels.length === 0 ? (
          showingArchived ? (
            <EmptyState icon={Archive} title="Nothing archived" action={{ href: "/funnels", label: "Back to your funnels" }}>
              Archiving a funnel takes it out of the main list without deleting its campaign kit.
            </EmptyState>
          ) : (
          <EmptyState icon={Inbox} title="No funnels yet" action={{ href: "/marketplace", label: "Browse the marketplace" }}>
            Use <span className="text-zinc-400">New funnel</span> to build one by hand, or promote
            an offer from the{" "}
            <Link href="/marketplace" className="underline">
              Marketplace
            </Link>{" "}
            — a generated kit&apos;s bridge page becomes a funnel here automatically.
          </EmptyState>
          )
        ) : (
          <FunnelsTable funnels={funnels} showingArchived={showingArchived} />
        )}
      </Card>
    </main>
  );
}
