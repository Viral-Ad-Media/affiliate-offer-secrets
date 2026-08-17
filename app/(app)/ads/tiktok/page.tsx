import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Music2, Link2, CircleAlert, ExternalLink, Radio, Coins, PauseCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import LoadFailed from "@/components/LoadFailed";
import ReadyToShip, { type ReadyItem } from "@/components/ReadyToShip";
import { tiktokAdsConfigured } from "@/lib/tiktok/adsConfig";

export const dynamic = "force-dynamic";

/**
 * TikTok Ads — the sibling of /ads (Meta), same read-only relationship to launching.
 *
 * The connection here is the MARKETING API one (tiktok_ad_accounts), which is a different TikTok
 * app from the Login Kit connection on Settings → Integrations that posts organic videos. Someone
 * can legitimately have one and not the other, so this page never infers one from the other.
 */

const CONNECT_MESSAGES: Record<string, { text: string; tone: "ok" | "warn" }> = {
  ok: { text: "TikTok ad account connected.", tone: "ok" },
  cancelled: { text: "Connection cancelled — nothing was changed.", tone: "warn" },
  error: { text: "That connection attempt failed. Try again.", tone: "warn" },
  no_advertisers: {
    text: "That TikTok account authorised us, but has no ad accounts we can act on.",
    tone: "warn",
  },
};

export default async function TiktokAdsPage({
  searchParams,
}: {
  searchParams: { connect?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  // Sanitized read — the RPC returns advertiser id/name/status and never the token.
  const [{ data: accounts }, { data: launches, error: launchError }, { data: scriptRows }] = await Promise.all([
    supabase.rpc("get_tiktok_ad_accounts", { p_workspace_id: ws }),
    supabase
      .from("tiktok_ad_launches")
      .select("id, status, angle_index, budget_credits, country, headline, created_at, campaign_id")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(100),
    // Generated TikTok scripts. 14 campaigns carry these and they appeared on no sidebar page —
    // the same invisibility /socials and /ads had. Unlike fb_ad_angles, tiktok_md is a single
    // markdown blob rather than a structured array, so this lists one entry per CAMPAIGN. It is
    // deliberately not parsed into individual hooks: email_md taught that lesson, where the model
    // emitted two different heading shapes and a parser tuned to one silently mangled half the
    // rows. A blob that opens in the campaign is honest; a mis-split one is not.
    supabase
      .from("campaigns")
      .select("id, name, product_id, tiktok_md, products(product_title)")
      .eq("workspace_id", ws)
      .not("tiktok_md", "is", null)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const connected = (accounts ?? []) as {
    advertiser_id: string;
    advertiser_name: string | null;
    is_active: boolean;
    status: string;
  }[];
  const rows = (launches ?? []) as { id: string; status: string; headline: string | null }[];
  const notice = searchParams.connect ? CONNECT_MESSAGES[searchParams.connect] : undefined;

  const readyScripts: ReadyItem[] = ((scriptRows ?? []) as any[])
    .filter((c) => String(c.tiktok_md ?? "").trim().length > 0)
    .map((c) => {
      const md = String(c.tiktok_md);
      // First meaningful line as the preview — enough to recognise which offer it is, without
      // pretending to have parsed the document's structure.
      const firstLine =
        md
          .split("\n")
          .map((l: string) => l.replace(/^[#>*\-\s]+/, "").trim())
          .find((l: string) => l.length > 0) ?? "";
      return {
        key: c.id as string,
        campaignTitle: (c.products?.product_title as string | undefined) ?? (c.name as string | null) ?? "Untitled",
        preview: firstLine.slice(0, 160) || "(empty script)",
        meta: `${Math.round(md.length / 100) / 10}k characters of hooks and scripts`,
        href: c.product_id ? `/product/${c.product_id}` : "/products",
      };
    });


  // Same three figures /ads reports for Meta, so the two sibling pages answer the same questions.
  // Budget is a DAILY authorization per launch, so summing across active ones is the real daily
  // number rather than a lifetime total.
  const active = rows.filter((r) => r.status === "active");
  const dailyCredits = active.reduce((sum, r) => sum + Number((r as { budget_credits?: number }).budget_credits ?? 0), 0);
  const awaitingReview = rows.filter((r) => r.status === "paused_review").length;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
            <Music2 className="h-6 w-6 text-emerald-400" /> TikTok Ads
          </h1>
          <p className="text-sm text-zinc-400">
            Ad accounts connected through TikTok for Business, and every launch made against them.
            Delivery, spend and results stay in TikTok&apos;s own Ads Manager, billed to your ad account.
          </p>
        </div>
        {tiktokAdsConfigured() && (
          <a href="/api/tiktok-ads/connect" className={cn(buttonVariants({ variant: "outline" }), "text-sm")}>
            <Link2 className="h-4 w-4" /> {connected.length > 0 ? "Connect another" : "Connect TikTok Ads"}
          </a>
        )}
      </header>

      {notice && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            notice.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          )}
        >
          {notice.text}
        </div>
      )}

      {/* Configuration is a deployment fact, not a user error — say which variables are missing
          rather than showing a Connect button that can only fail. */}
      {!tiktokAdsConfigured() && (
        <Card as="section" className="flex items-start gap-2 p-4">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-sm text-zinc-300">
            TikTok Ads isn&apos;t configured on this deployment.
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              It needs a TikTok for Business app with Marketing API access, then{" "}
              <code className="text-zinc-400">TIKTOK_ADS_APP_ID</code> and{" "}
              <code className="text-zinc-400">TIKTOK_ADS_SECRET</code> set as environment variables.
              This is a separate app from the TikTok connection on Settings → Integrations, which
              posts organic videos and cannot run ads.
            </p>
          </div>
        </Card>
      )}

      {launchError && <LoadFailed what="your TikTok ad launches" detail={launchError.message} />}

      {/* "Ready to use", NOT "ready to launch": launching TikTok ads from here is not built (the
          Marketing API's create endpoints could not be verified without a real advertiser account,
          and writing them unverified is how you spend money wrongly). Promising a button that does
          not exist would be worse than saying what these are — copy you can take to TikTok now. */}
      <ReadyToShip
        icon={Music2}
        title="Scripts ready to use"
        blurb="Generated with a campaign kit"
        items={readyScripts}
        actionLabel="Open campaign"
        emptyNote="Nothing waiting — tick TikTok scripts when you build a kit and they show up here."
      />

      {tiktokAdsConfigured() && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="stat-tile">
            <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <div className="stat-tile-value">{connected.length}</div>
              <div className="stat-tile-label">Ad accounts</div>
            </div>
          </div>
          <div className="stat-tile">
            <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="stat-tile-value">{active.length}</div>
              <div className="stat-tile-label">Active ads</div>
            </div>
          </div>
          <div className="stat-tile">
            <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <div className="stat-tile-value">{dailyCredits}</div>
              <div className="stat-tile-label">Daily credits authorized</div>
            </div>
          </div>
          <div className="stat-tile">
            <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
              <PauseCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="stat-tile-value">{awaitingReview}</div>
              <div className="stat-tile-label">Awaiting review</div>
            </div>
          </div>
        </section>
      )}

      {tiktokAdsConfigured() && connected.length > 0 && (
        <Card as="section" className="overflow-hidden">
          <div className="border-b border-ink-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">Ad accounts</h2>
          </div>
          <ul className="divide-y divide-ink-800">
            {connected.map((a) => (
              <li key={a.advertiser_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-200">
                    {a.advertiser_name ?? a.advertiser_id}
                  </div>
                  <div className="text-xs text-zinc-500">{a.advertiser_id}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.is_active && <Badge className="border-emerald-500/40 text-emerald-300">Active</Badge>}
                  {a.status === "needs_reconnect" && (
                    <Badge className="border-amber-500/40 text-amber-300">Reconnect</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" className="overflow-hidden">
        <div className="border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Launches</h2>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Music2} title="No TikTok ads launched yet">
            {connected.length === 0
              ? "Connect a TikTok ad account above to get started."
              : "Launching runs from an ad angle on the campaign page, the same as Meta — so the angle's copy and creative are in front of you when you commit budget."}
            <a
              href="https://ads.tiktok.com"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "mt-3 text-sm")}
            >
              <ExternalLink className="h-4 w-4" /> Open TikTok Ads Manager
            </a>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-800">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate text-sm text-zinc-200">{l.headline ?? "Untitled launch"}</span>
                <Badge className="shrink-0">{l.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
