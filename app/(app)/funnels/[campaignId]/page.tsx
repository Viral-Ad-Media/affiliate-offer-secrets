"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Campaign, FunnelStep } from "@/lib/shared";
import PublishBridge from "@/components/PublishBridge";
import PageEditor from "@/components/PageEditor";
import SplitTestPanel from "@/components/SplitTestPanel";
import FunnelStepsSection from "@/components/FunnelStepsSection";

export default function FunnelPage({ params }: { params: { campaignId: string } }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [productTitle, setProductTitle] = useState("");
  const [hoplink, setHoplink] = useState<string | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [crossSellOptions, setCrossSellOptions] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: c } = await supabase
      .from("campaigns")
      .select("*, products(product_title, hoplink)")
      .eq("id", params.campaignId)
      .maybeSingle();

    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setCampaign(c as unknown as Campaign);
    setProductTitle((c as any).products?.product_title ?? "Untitled");
    setHoplink((c as any).products?.hoplink ?? null);

    const [{ data: stepRows }, { data: products }] = await Promise.all([
      supabase
        .from("funnel_steps")
        .select("*")
        .eq("campaign_id", params.campaignId)
        .order("step_index", { ascending: true }),
      supabase.from("products").select("id, product_title").neq("id", (c as any).product_id),
    ]);

    setSteps((stepRows ?? []) as FunnelStep[]);
    setCrossSellOptions((products ?? []).map((p: any) => ({ id: p.id, title: p.product_title })));
    setLoading(false);
  }, [params.campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (notFound || !campaign) {
    return (
      <main className="space-y-4">
        <Link href="/funnels" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Funnels
        </Link>
        <p className="text-sm text-zinc-500">Funnel not found.</p>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <Link href="/funnels" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Back to Funnels
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-zinc-100">{productTitle}</h1>
        <p className="text-sm text-zinc-400">
          Publishing is one switch for the whole funnel — the opt-in page and every step below go
          live (or offline) together.
        </p>
      </header>

      {!campaign.page_copy ? (
        <p className="rounded-lg bg-ink-800 p-4 text-sm text-zinc-400">
          This campaign was generated before the no-code editor existed, so there's no structured
          copy to edit yet. Regenerate the campaign kit from the{" "}
          <Link href="/campaigns" className="underline">
            Campaigns
          </Link>{" "}
          page to enable editing.
        </p>
      ) : (
        <>
          <PublishBridge campaignId={campaign.id} initialPublished={campaign.bridge_published} />

          <SplitTestPanel campaignId={campaign.id} productTitle={productTitle} previewHoplink={hoplink ?? "#"} />

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">Opt-in page</h2>
            <PageEditor
              campaignId={campaign.id}
              productTitle={productTitle}
              initialCopy={campaign.page_copy}
              initialBridgeHtml={campaign.bridge_html}
              previewHoplink={hoplink ?? "#"}
              onSaved={({ bridge_html, page_copy }) =>
                setCampaign((c) => (c ? { ...c, bridge_html, page_copy } : c))
              }
            />
          </section>

          <FunnelStepsSection
            campaignId={campaign.id}
            productTitle={productTitle}
            steps={steps}
            crossSellOptions={crossSellOptions}
            onChanged={load}
          />
        </>
      )}
    </main>
  );
}
