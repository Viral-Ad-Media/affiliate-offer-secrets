import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Megaphone,
  Inbox,
  Image as ImageIcon,
  Video,
  Coins,
  CircleCheck,
  CirclePause,
  CircleAlert,
  Loader2,
  ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Ads Manager: every ad launch this account has created, across all campaigns and angles.
//
// Read-only by design, same relationship the Funnels list has to /funnels/[campaignId]: creating,
// activating and pausing a launch all happen on the angle's own card (components/LaunchAd.tsx,
// mounted per angle inside AdAnglesPanel on the product page), where the angle's copy and its
// generated creative are actually in front of you. Duplicating the activate flow here would mean
// two places that spend credits — the exact thing the paused-until-confirmed design avoids.
//
// Meta's own Ads Manager remains the source of truth for delivery, spend and results; this page
// answers "what have I launched, from which angle, and what state is it in" — which Meta can't
// answer, because it doesn't know about campaigns/angles.

const STATUS_META: Record<
  string,
  { label: string; className: string; Icon: typeof CircleCheck }
> = {
  building: {
    label: "Building",
    className: "border-ink-600 bg-ink-800 text-zinc-400",
    Icon: Loader2,
  },
  paused_review: {
    label: "Paused — awaiting your review",
    className: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    Icon: CirclePause,
  },
  activating: {
    label: "Activating",
    className: "border-sky-500/30 bg-sky-500/15 text-sky-300",
    Icon: Loader2,
  },
  active: {
    label: "Active",
    className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    Icon: CircleCheck,
  },
  failed: {
    label: "Failed",
    className: "border-red-500/30 bg-red-500/15 text-red-300",
    Icon: CircleAlert,
  },
};

export default async function AdsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const [{ data: launches }, metaStatus] = await Promise.all([
    // Membership RLS is the scoping; .eq("workspace_id") is kept explicit to match the style of
    // every other list page here, and to keep a member of two workspaces from seeing both merged.
    supabase
      .from("ad_launches")
      .select(
        "id, campaign_id, angle_index, creative_kind, status, budget_credits, country, headline, notes, meta_ad_id, created_at, campaigns(product_id, products(product_title))"
      )
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("get_meta_connection_status").then((r) => r.data ?? { connected: false }),
  ]);

  const rows = ((launches ?? []) as any[]).map((l) => ({
    id: l.id as string,
    campaignId: l.campaign_id as string,
    productId: (l.campaigns?.product_id as string | undefined) ?? null,
    title: (l.campaigns?.products?.product_title as string | undefined) ?? "Untitled campaign",
    angleIndex: l.angle_index as number,
    creativeKind: l.creative_kind as "image" | "video",
    status: l.status as string,
    budget: l.budget_credits as number,
    country: (l.country as string | null) ?? null,
    headline: (l.headline as string | null) ?? null,
    notes: (l.notes as string | null) ?? null,
    metaAdId: (l.meta_ad_id as string | null) ?? null,
  }));

  const active = rows.filter((r) => r.status === "active");
  // Budget is a DAILY figure per launch (CBO daily budget), so summing across active launches is
  // the real daily authorization — not a lifetime total.
  const dailyCredits = active.reduce((sum, r) => sum + (r.budget ?? 0), 0);
  const awaitingReview = rows.filter((r) => r.status === "paused_review").length;

  const adsReady = Boolean((metaStatus as any)?.connected && (metaStatus as any)?.ads_management_granted);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
          <Megaphone className="h-6 w-6 text-emerald-400" /> Ads Manager
        </h1>
        <p className="text-sm text-zinc-400">
          Every Meta ad you&apos;ve launched, per campaign and per angle. Launch and activate from
          an angle&apos;s own card on its campaign page — delivery, spend and results stay in
          Meta&apos;s own Ads Manager, billed to your ad account.
        </p>
      </header>

      {!adsReady && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-500/30 p-4">
          <p className="text-sm text-amber-300">
            {(metaStatus as any)?.connected
              ? "Facebook is connected, but ad permissions weren't granted — reconnect and accept ads_management to launch ads."
              : "Connect Facebook with ad permissions before you can launch ads."}
          </p>
          <Link href="/settings/integrations" className="btn-ghost text-xs">
            Go to Integrations
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> Active ads
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">{active.length}</div>
          <div className="mt-1 text-xs text-zinc-500">Live and delivering on Meta</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <Coins className="h-3.5 w-3.5 text-emerald-400" /> Daily budget authorized
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">{dailyCredits}</div>
          <div className="mt-1 text-xs text-zinc-500">
            Credits/day across active ads — Meta bills your own ad account
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <CirclePause className="h-3.5 w-3.5 text-amber-300" /> Awaiting review
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">{awaitingReview}</div>
          <div className="mt-1 text-xs text-zinc-500">Paused drafts you haven&apos;t activated</div>
        </div>
      </div>

      <section className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Inbox className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
            <p className="text-sm text-zinc-400">No ads launched yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Open a campaign from{" "}
              <Link href="/marketplace" className="underline">
                Marketplace
              </Link>
              , pick an ad angle, generate its image or video, then launch it from that
              angle&apos;s card.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Angle</th>
                  <th>Creative</th>
                  <th>Status</th>
                  <th className="text-right">Daily budget</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.building;
                  const StatusIcon = meta.Icon;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-zinc-100">{r.title}</div>
                        {r.headline && (
                          <div className="mt-0.5 max-w-md truncate text-xs text-zinc-500" title={r.headline}>
                            {r.headline}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-zinc-400">#{r.angleIndex + 1}</td>
                      <td className="px-2 py-2.5">
                        <span className="chip border-ink-600 bg-ink-800 text-zinc-400">
                          {r.creativeKind === "video" ? (
                            <Video className="h-3 w-3" />
                          ) : (
                            <ImageIcon className="h-3 w-3" />
                          )}
                          {r.creativeKind === "video" ? "Video" : "Image"}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={`chip ${meta.className}`} title={r.notes ?? undefined}>
                          <StatusIcon className="h-3 w-3" /> {meta.label}
                        </span>
                        {r.country && <span className="ml-2 text-xs text-zinc-600">{r.country}</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-zinc-300">
                        {r.status === "active" ? `${r.budget} cr/day` : `${r.budget} cr`}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.productId ? (
                          <Link
                            href={`/product/${r.productId}?tab=fb_ads_md`}
                            className="btn-ghost text-xs"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Manage
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-600">Campaign removed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
