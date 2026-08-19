import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BarChart3, Users, Eye, MousePointerClick, Percent, Send, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { Sparkline } from "@/components/OverviewPerformance";
import { getLeadTrend, getTopFunnels, MIN_VIEWS_FOR_RATE } from "@/lib/overview";

export const dynamic = "force-dynamic";

// Analytics: the numbers this app records itself — nothing here depends on an ad platform being
// connected; Meta's own reporting stays the source of truth for spend and delivery.
//
// This page was counts-only until funnel_page_stats (0110) started keeping real per-page traffic:
// views (deduped visitors) and outbound link clicks per funnel page. That is the shape that makes
// an opt-in rate and a per-funnel table honest instead of fabricated — and contacts.created_at
// has always been dated, so the 30-day lead trend was available all along (the Overview already
// draws it; this reuses the same helper and the same sparkline so the two can never disagree).

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
      <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-100">{value}</div>
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
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    contacts,
    published,
    sends,
    sends30,
    smsSent,
    { data: pageStats },
    leadTrend,
    topFunnels,
  ] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "published"),
    supabase
      .from("broadcast_sends")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "sent"),
    supabase
      .from("broadcast_sends")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "sent")
      .gte("created_at", since30),
    supabase
      .from("sms_sends")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("status", "sent"),
    // Bounded by construction: one row per (campaign, page), so this never grows with traffic.
    supabase.from("funnel_page_stats").select("page_key, views, clicks").eq("workspace_id", ws),
    getLeadTrend(supabase, ws!),
    getTopFunnels(supabase, ws!, 10),
  ]);

  let optinViews = 0;
  let totalViews = 0;
  let totalClicks = 0;
  for (const r of pageStats ?? []) {
    const v = Number(r.views ?? 0);
    totalViews += v;
    totalClicks += Number(r.clicks ?? 0);
    if (r.page_key === "optin") optinViews += v;
  }
  const leads = contacts.count ?? 0;
  // Gated exactly like the split-test confidence figure: a rate computed from a handful of views
  // is noise presented as a result. The tile says what it still needs instead.
  const optinRate = optinViews >= MIN_VIEWS_FOR_RATE ? `${((leads / optinViews) * 100).toFixed(1)}%` : "—";
  const leads30 = leadTrend.reduce((sum, p) => sum + p.count, 0);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
          <BarChart3 className="h-6 w-6 text-emerald-400" /> Analytics
        </h1>
        <p className="text-sm text-zinc-400">
          What your funnels, blog and messaging have done — measured by this app itself. Ad spend
          and delivery live in Meta&apos;s own reporting.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Leads captured"
          value={leads.toLocaleString()}
          hint={`${leads30.toLocaleString()} in the last 30 days`}
          href="/contacts"
          Icon={Users}
        />
        <StatCard
          label="Funnel page views"
          value={totalViews.toLocaleString()}
          hint="Unique visitors per page, opt-in pages and steps"
          href="/funnels"
          Icon={Eye}
        />
        <StatCard
          label="Link clicks"
          value={totalClicks.toLocaleString()}
          hint="Outbound clicks from funnel pages — offer CTAs included"
          href="/funnels"
          Icon={MousePointerClick}
        />
        <StatCard
          label="Opt-in rate"
          value={optinRate}
          hint={
            optinViews >= MIN_VIEWS_FOR_RATE
              ? `${leads.toLocaleString()} leads ÷ ${optinViews.toLocaleString()} opt-in page visitors`
              : `Shown after ${MIN_VIEWS_FOR_RATE} opt-in page visitors (${optinViews} so far)`
          }
          Icon={Percent}
        />
        <StatCard
          label="Messages sent"
          value={((sends.count ?? 0) + (smsSent.count ?? 0)).toLocaleString()}
          hint={`${(sends30.count ?? 0).toLocaleString()} emails in the last 30 days · ${(smsSent.count ?? 0).toLocaleString()} SMS all-time`}
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

      <Card as="section" className="p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Leads — last 30 days</h2>
          <span className="text-xs text-zinc-500">{leads30.toLocaleString()} captured</span>
        </div>
        <Sparkline points={leadTrend} />
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-100">Funnel performance</h2>
        {topFunnels.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No funnel has captured a lead yet — publish one and point traffic at it, and this table
            fills in.
          </p>
        ) : (
          <Card className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <tr>
                  <TableHead edge>Funnel</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead edge className="text-right">Opt-in rate</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {topFunnels.map((f) => (
                  <TableRow key={f.campaignId}>
                    <td>
                      <Link href={`/funnels/${f.campaignId}`} className="text-zinc-200 hover:text-emerald-300">
                        {f.title}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums text-zinc-400">{f.views.toLocaleString()}</td>
                    <td className="text-right tabular-nums text-zinc-400">{f.clicks.toLocaleString()}</td>
                    <td className="text-right tabular-nums text-zinc-300">{f.leads.toLocaleString()}</td>
                    <td
                      className="text-right tabular-nums text-zinc-300"
                      title={f.rate === null ? `Shown after ${MIN_VIEWS_FOR_RATE} views` : undefined}
                    >
                      {f.rate === null ? "—" : `${f.rate.toFixed(1)}%`}
                    </td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Views count unique visitors to each funnel&apos;s opt-in page; clicks count outbound link
          clicks across all of its pages. Both started recording when per-page stats shipped, so
          older traffic shows only where a split test was already counting.
        </p>
      </section>
    </main>
  );
}
