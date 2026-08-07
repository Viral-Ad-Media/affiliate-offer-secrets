import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId } from "@/lib/workspace";
import { funnelPathSlug } from "@/lib/funnelSteps";
import { normalizePageCopy } from "@/lib/engine/renderPages";
import { funnelPageChecklist, funnelStepChecklist, type ChecklistItem } from "@/lib/pageChecklist";
import { STEP_TYPE_LABELS } from "@/lib/funnelTypes";
import type { FunnelStepType } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** Labels of the REQUIRED items still outstanding. Recommended ones never block publishing. */
function missingRequired(items: ChecklistItem[]): string[] {
  return items.filter((i) => i.severity === "required" && !i.done).map((i) => i.label);
}

// Toggles whether a campaign's bridge page is publicly reachable (servePublicCampaignPage /
// lib/publicPage.ts now requires bridge_published = true, not just status = 'ready'). Ownership
// check via the RLS-respecting user-scoped client first, same pattern as page-copy/route.ts; the
// actual write goes through the admin client since campaigns has no client-write RLS.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const campaignId = params.id;

  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_campaign", {
    p_campaign_id: campaignId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const published = body.published === true;

  const admin = createAdminClient();

  // Unpublishing is never gated. Taking a live page DOWN must always work — the one thing worse
  // than an incomplete published page is an incomplete published page you can't retract.
  if (published) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("status, bridge_html, page_copy, funnel_type")
      .eq("id", campaignId)
      .single();
    if (!campaign || campaign.status !== "ready" || !campaign.bridge_html) {
      return NextResponse.json(
        { error: "Bridge page isn't ready to publish yet — the campaign kit must finish building first" },
        { status: 400 }
      );
    }

    // Publishing is the gate; saving a draft never is. This is the real boundary — PublishBridge
    // disables its own button too, but that's UX: this route is directly callable.
    const missing = missingRequired(
      funnelPageChecklist(campaign.funnel_type, normalizePageCopy(campaign.page_copy, null))
    );

    // One publish switch covers the opt-in page AND every step, so a step missing its essentials
    // would go live under the same toggle — it has to be checked here too or the gate is a
    // half-measure that only guards the first page of the funnel.
    const { data: steps } = await admin
      .from("funnel_steps")
      .select("step_type, step_index, page_copy")
      .eq("campaign_id", campaignId)
      .order("step_index");

    for (const s of steps ?? []) {
      const stepMissing = missingRequired(
        funnelStepChecklist(s.step_type, normalizePageCopy(s.page_copy, null, { stepType: s.step_type }))
      );
      missing.push(...stepMissing.map((m) => `Step ${s.step_index} (${STEP_TYPE_LABELS[s.step_type as FunnelStepType]}): ${m}`));
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "This funnel is missing elements its type needs before it can go live.",
          missing,
        },
        { status: 400 }
      );
    }
  }

  const { error: updateErr } = await admin
    .from("campaigns")
    .update({ bridge_published: published })
    .eq("id", campaignId);
  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  const mappedUrl = published ? await autoMapToPrimaryDomain(supabase, admin, campaignId) : null;

  return NextResponse.json({ ok: true, published, mappedUrl });
}

/**
 * Put a newly-published funnel on the workspace's default domain, automatically.
 *
 * `custom_domains.is_primary` has been claimed automatically by the first verified domain since
 * 0078 — but nothing ever consumed it for funnels. A funnel's public URL comes from a
 * `custom_domain_routes` row and nothing else (see /funnels and PublishBridge), and the only way
 * to create one was to find the Domains page and fill in a path by hand. So "the domain you added
 * is the default for blog and funnels" was only half true: the blog really did start serving on it
 * (serves_blog), while every funnel stayed on /p/{id}/bridge.
 *
 * Best-effort by construction: the publish itself has already succeeded and been reported, and a
 * funnel that is live on the default URL but not yet branded is a much better outcome than a
 * publish that fails because a domain lookup did.
 */
async function autoMapToPrimaryDomain(
  supabase: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<string | null> {
  try {
    // Never a second mapping. If this funnel already has a route — placed by hand or by an earlier
    // publish — that is the operator's choice, and re-adding on every republish would quietly
    // accumulate duplicate URLs for the same page.
    const { data: existing } = await admin
      .from("custom_domain_routes")
      .select("id")
      .eq("campaign_id", campaignId)
      .limit(1)
      .maybeSingle();
    if (existing) return null;

    const ws = await currentWorkspaceId();
    if (!ws) return null;

    // Only a VERIFIED primary: a pending domain's DNS doesn't point here yet, so mapping onto it
    // would hand back a branded link that 404s — the same reason 0078's trigger fires on the
    // transition to verified rather than on add.
    const { data: domain } = await admin
      .from("custom_domains")
      .select("id, domain")
      .eq("workspace_id", ws)
      .eq("status", "verified")
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle();
    if (!domain) return null;

    const { data: campaign } = await admin
      .from("campaigns")
      .select("name, products(product_title)")
      .eq("id", campaignId)
      .single();
    const title =
      ((campaign as any)?.products?.product_title as string | undefined) ??
      ((campaign as any)?.name as string | null) ??
      "funnel";

    // Never the bare root. That path belongs to the blog when this domain also serves it
    // (custom_domains.serves_blog), and taking it silently would displace the blog index.
    const base = funnelPathSlug(title);
    const { data: taken } = await admin
      .from("custom_domain_routes")
      .select("path")
      .eq("domain_id", domain.id);
    const used = new Set((taken ?? []).map((r: any) => String(r.path)));
    let path = base;
    for (let n = 2; used.has(path); n++) path = `${base}-${n}`;

    // Through the RPC, on the USER's client — so the domain-membership and campaign-ownership
    // checks both really run. A direct admin insert here would be the one write path in this
    // feature that skips them.
    const { error } = await supabase.rpc("add_domain_route", {
      p_domain_id: domain.id,
      p_path: path,
      p_campaign_id: campaignId,
      p_destination: "bridge",
    });
    if (error) return null;

    return `https://${domain.domain}/${path}`;
  } catch {
    return null;
  }
}
