import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Radio, ExternalLink, Inbox, Beaker } from "lucide-react";

// A "funnel" isn't its own entity — it's a derived view over campaigns that already have a bridge
// (lead-capture) page generated. A funnel appears here automatically the moment stagePages
// (lib/engine/build.ts) writes campaigns.bridge_html; there's nothing to explicitly create or keep
// in sync. Publishing/editing still happens on the product page's Bridge page tab (PublishBridge /
// PageEditor) — this page is a list/overview, not a second place that writes campaign state.
export default async function FunnelsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: campaigns }, { data: routes }, { data: contactRows }, { data: variantRows }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, product_id, bridge_published, updated_at, products(product_title)")
      .not("bridge_html", "is", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("custom_domain_routes")
      .select("campaign_id, path, custom_domains(domain, status)")
      .eq("destination", "bridge"),
    supabase.from("contacts").select("campaign_id").not("campaign_id", "is", null).limit(1000),
    supabase.from("bridge_variants").select("campaign_id"),
  ]);

  const leadCounts = new Map<string, number>();
  for (const c of contactRows ?? []) {
    leadCounts.set(c.campaign_id as string, (leadCounts.get(c.campaign_id as string) ?? 0) + 1);
  }

  const variantCounts = new Map<string, number>();
  for (const v of variantRows ?? []) {
    variantCounts.set(v.campaign_id as string, (variantCounts.get(v.campaign_id as string) ?? 0) + 1);
  }

  // First verified custom-domain route wins if a campaign has more than one — same "just show one
  // representative link" simplification PublishBridge.tsx's own summary already makes.
  const domainUrlByCampaign = new Map<string, string>();
  for (const r of (routes ?? []) as any[]) {
    if (r.custom_domains?.status !== "verified") continue;
    if (domainUrlByCampaign.has(r.campaign_id)) continue;
    domainUrlByCampaign.set(r.campaign_id, `https://${r.custom_domains.domain}/${r.path}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const funnels = (campaigns ?? []).map((c: any) => ({
    id: c.id as string,
    productId: c.product_id as string,
    title: (c.products?.product_title as string | undefined) ?? "Untitled",
    published: c.bridge_published as boolean,
    leads: leadCounts.get(c.id) ?? 0,
    url: domainUrlByCampaign.get(c.id) ?? `${appUrl}/p/${c.id}/bridge`,
    variantCount: variantCounts.get(c.id) ?? 0,
  }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Funnels</h1>
        <p className="text-sm text-zinc-400">
          Every lead-capture bridge page your campaigns have generated. A funnel shows up here
          automatically as soon as a campaign kit finishes building.
        </p>
      </header>

      <section className="card overflow-hidden">
        {funnels.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Inbox className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
            <p className="text-sm text-zinc-400">No funnels yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Build a campaign kit from the{" "}
              <Link href="/campaigns" className="underline">
                Campaigns
              </Link>{" "}
              page — its bridge page becomes a funnel here the moment it's generated.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Funnel</th>
                  <th>Status</th>
                  <th>Link</th>
                  <th className="text-right">Leads</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {funnels.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2.5 font-medium text-zinc-100">{f.title}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`chip ${
                            f.published
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : "border-ink-600 bg-ink-800 text-zinc-400"
                          }`}
                        >
                          <Radio className="h-3 w-3" /> {f.published ? "Published" : "Draft"}
                        </span>
                        {f.variantCount > 0 && (
                          <span className="chip border-sky-500/30 bg-sky-500/15 text-sky-300">
                            <Beaker className="h-3 w-3" /> Testing ({f.variantCount})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-xs px-2 py-2.5 text-xs text-zinc-400">
                      {f.published ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 truncate hover:text-emerald-400"
                        >
                          <span className="truncate">{f.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span>Not publicly reachable until published</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{f.leads}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/product/${f.productId}?tab=bridge_html`} className="btn-ghost">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
