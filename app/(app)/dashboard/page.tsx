import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SetupChecklist, { type SetupStep } from "@/components/SetupChecklist";
import MarketplaceHighlights from "@/components/MarketplaceHighlights";
import NeedsAttention from "@/components/NeedsAttention";
import OverviewPerformance from "@/components/OverviewPerformance";
import { getAttentionItems, getCreditRunway, getLeadTrend, getTopFunnels } from "@/lib/overview";
import { JOB_CREDIT_COST } from "@/lib/credits";
import {
  Megaphone,
  Link2,
  Globe,
  Users,
  Send,
  Package,
  CheckCircle2,
  Contact,
  Radio,
} from "lucide-react";

function StatTile({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  href: string;
}) {
  // A link, not a display: every one of these numbers has a page that lists the things it counts,
  // and a tile you can only read makes the reader go find that page in the sidebar themselves.
  return (
    <Link href={href} className="stat-tile hover:border-emerald-500/50">
      <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
        {icon}
      </div>
      <div>
        <div className="stat-tile-value">{value}</div>
        <div className="stat-tile-label">{label}</div>
      </div>
    </Link>
  );
}

const QUICK_LINKS = [
  {
    href: "/marketplace",
    icon: Megaphone,
    label: "Marketplace",
    description: "Discover products and build campaign kits.",
  },
  {
    href: "/settings/integrations",
    icon: Link2,
    label: "Integrations",
    description: "Connect affiliate networks, Meta, and other platforms.",
  },
  {
    href: "/settings/domains",
    icon: Globe,
    label: "Domains",
    description: "Publish presell and bridge pages on your own domain.",
  },
  {
    href: "/contacts",
    icon: Users,
    label: "Contacts",
    description: "See leads captured from your bridge pages.",
  },
  {
    href: "/emails/sequences",
    icon: Send,
    label: "Broadcast",
    description: "Send and schedule email sequences to your contacts.",
  },
];

export default async function Overview() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  const [
    { count: productsCount },
    { count: campaignsReadyCount },
    { count: contactsCount },
    { count: activeSequencesCount },
    { count: networkCount },
    { count: publishedFunnelCount },
    { data: workspace },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "ready"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase
      .from("broadcast_sequences")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "active"),
    // The two extra counts the checklist needs. Both are head-only, so they cost a count and no rows.
    supabase
      .from("network_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("bridge_published", true),
    supabase.from("workspaces").select("setup_dismissed_at").eq("id", ws).maybeSingle(),
  ]);

  // Derived from the counts above, never stored — so a step un-ticks itself if the thing it
  // describes goes away, and nothing has to remember to mark a step done.
  const setupSteps: SetupStep[] = [
    {
      key: "network",
      label: "Connect an affiliate network",
      // Rewritten when link construction was removed (content rule 4): the app no longer
      // generates hoplinks, so the old "goes into every hoplink" claim had become false.
      hint: "Record which network each offer pays you through. You'll paste each product's own affiliate link after its kit is built.",
      href: "/settings/integrations",
      cta: "Connect",
      done: (networkCount ?? 0) > 0,
    },
    {
      key: "products",
      label: "Find products to promote",
      hint: "Browse the marketplace and track a few offers worth testing.",
      href: "/marketplace",
      cta: "Browse",
      done: (productsCount ?? 0) > 0,
    },
    {
      key: "kit",
      label: "Build your first campaign kit",
      hint: "Promote a tracked product and the app writes the ads, funnel pages, article and email swipes for it.",
      href: "/marketplace",
      cta: "Promote one",
      done: (campaignsReadyCount ?? 0) > 0,
    },
    {
      key: "publish",
      label: "Publish a funnel",
      hint: "A kit's opt-in page only starts collecting leads once it's published and reachable.",
      href: "/funnels",
      cta: "Publish",
      done: (publishedFunnelCount ?? 0) > 0,
    },
  ];

  // The four new panels, fetched together. Deliberately AFTER the counts above rather than folded
  // into that Promise.all: these are the expensive ones, and keeping them separate makes it obvious
  // which queries the tiles need and which the panels do.
  const [attention, runway, leadTrend, topFunnels] = await Promise.all([
    getAttentionItems(supabase, ws!),
    getCreditRunway(supabase, ws!, JOB_CREDIT_COST.build_campaign),
    getLeadTrend(supabase, ws!),
    getTopFunnels(supabase, ws!),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Overview</h1>
        <p className="text-sm text-zinc-400">What needs you, how you&apos;re doing, and what to promote next.</p>
      </header>

      {!workspace?.setup_dismissed_at && <SetupChecklist steps={setupSteps} workspaceId={ws!} />}

      {/* Above the tiles on purpose: the tiles say what EXISTS, this says what to do about it. */}
      <NeedsAttention items={attention} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Package className="h-5 w-5" />} label="Products tracked" value={productsCount ?? 0} href="/products" />
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Campaigns ready"
          value={campaignsReadyCount ?? 0}
          href="/funnels"
        />
        <StatTile icon={<Contact className="h-5 w-5" />} label="Contacts captured" value={contactsCount ?? 0} href="/contacts" />
        <StatTile
          icon={<Radio className="h-5 w-5" />}
          label="Active sequences"
          value={activeSequencesCount ?? 0}
          href="/emails/sequences"
        />
      </section>

      {/* Moved here from Marketplace. It answers "what should I even look at", which is an
          Overview question — Marketplace answers "find me products in X", and having both on one
          page put the browse-the-catalog panel above the discovery form's own results. No
          `onAdded` callback: this is a server component, and there's no products table on this
          page to refresh — the panel marks the row added and toasts on its own. The tile counts
          above go stale until the next load, which is the honest trade for putting it here. */}
      <OverviewPerformance runway={runway} leads={leadTrend} funnels={topFunnels} />

      <MarketplaceHighlights />

      {/* Only while onboarding. These five cards restate sidebar destinations with a sentence of
          orientation — genuinely useful in week one, pure duplication of the nav afterwards. Tied
          to the same signal the checklist uses, so the two disappear together and the page tightens
          for a returning operator instead of ending in a nav they already have. */}
      {!workspace?.setup_dismissed_at && !setupSteps.every((st) => st.done) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zinc-100">Get started</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl border border-ink-700 bg-ink-900 flex items-start gap-3 p-4 transition-colors hover:border-emerald-500/50"
              >
                <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
                  <link.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{link.label}</div>
                  <div className="text-xs text-zinc-500">{link.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
