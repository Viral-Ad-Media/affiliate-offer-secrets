import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BarChart3, Users, Eye, Send, FileText, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Analytics: the numbers this app already records, gathered in one place. Everything here comes
// from data the app owns — bridge-page views, captured leads, emails sent, posts published — so
// nothing depends on an ad platform being connected.
//
// Deliberately counts only: rates and time series need per-day rollups the schema doesn't keep
// yet (views live as a running total on bridge_variants, not as dated rows). Better to show four
// honest numbers than a chart built from a shape the data can't support.

function StatCard({
  label,
  value,
  hint,
  href,
  Icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  href?: string;
  Icon: typeof Users;
}) {
  const body = (
    <Card className="h-full p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Icon className="h-3.5 w-3.5 text-emerald-400" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-100">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function AnalyticsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  // head:true count queries — none of these pull rows, so the page cost doesn't grow with the
  // data behind it.
  const [contacts, published, sends, campaignsReady, variants, funnelsLive] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "published"),
    supabase.from("broadcast_sends").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "ready"),
    // Views are a running total per split-test variant, so they only exist for funnels that have
    // a test running — stated in the hint rather than presented as total traffic.
    supabase.from("bridge_variants").select("views").eq("workspace_id", ws),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("bridge_published", true),
  ]);

  const variantViews = (variants.data ?? []).reduce((sum, v) => sum + ((v.views as number) ?? 0), 0);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
          <BarChart3 className="h-6 w-6 text-emerald-400" /> Analytics
        </h1>
        <p className="text-sm text-zinc-400">
          What your funnels, blog and emails have done so far. Ad spend and clicks live in Meta&apos;s
          own reporting — these are the numbers this app records itself.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Leads captured"
          value={contacts.count ?? 0}
          hint="Opt-ins from your bridge pages and imports"
          href="/contacts"
          Icon={Users}
        />
        <StatCard
          label="Funnels live"
          value={funnelsLive.count ?? 0}
          hint={`${campaignsReady.count ?? 0} campaign ${
            (campaignsReady.count ?? 0) === 1 ? "kit" : "kits"
          } built`}
          href="/funnels"
          Icon={TrendingUp}
        />
        <StatCard
          label="Split-test views"
          value={variantViews}
          hint="Counted only on funnels with a split test running"
          href="/funnels"
          Icon={Eye}
        />
        <StatCard
          label="Emails sent"
          value={sends.count ?? 0}
          hint="Broadcasts and sequence steps delivered"
          href="/emails/sequences"
          Icon={Send}
        />
        <StatCard
          label="Posts published"
          value={published.count ?? 0}
          hint="Live on your public blog"
          href="/blog/posts"
          Icon={FileText}
        />
      </div>

      <p className="text-xs text-zinc-500">
        Trends over time need per-day figures the app doesn&apos;t record yet — page views are kept
        as a running total rather than dated rows. Say the word and that becomes the next piece.
      </p>
    </main>
  );
}
