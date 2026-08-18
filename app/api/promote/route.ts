import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { isBuildable } from "@/lib/funnelTypes";
import { normalizeKitAssets, normalizeKitCounts } from "@/lib/kitAssets";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json();
  const productId = body.product_id as string;
  // Which kit pieces to generate. Absent means everything, so an older client or a direct API call
  // keeps the previous behaviour rather than silently queueing a build that produces nothing.
  const assets = normalizeKitAssets(body.assets);
  // How many of each. Clamped to each asset's own range here as well as in the worker — the
  // route is reachable directly, so the range is enforced where the value is stored, not only
  // where the dialog offers it.
  const counts = normalizeKitCounts(body.counts);
  // The funnel's TYPE (0084's funnel_type column; picker in PromoteKitDialog). Anything that
  // isn't a buildable catalog entry falls back to bridge — a stale client naming a type this
  // build can't deliver should get the historical page, not a 400 that blocks the whole kit.
  const funnelType =
    typeof body.funnel_type === "string" && isBuildable(body.funnel_type) ? body.funnel_type : "bridge";

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", ws)
    .single();
  if (productError || !product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  // Deliberately no affiliate-connection gate. A kit no longer contains a derived link, so
  // requiring an affiliate ID before building one would refuse real work over a value that
  // reaches no output. The link is prompted for after the build instead, where it is pasted from
  // the network's own dashboard — see components/OfferLinkPrompt.tsx.

  const { data: open } = await supabase
    .from("jobs")
    .select("id")
    .eq("workspace_id", ws)
    .eq("type", "build_campaign")
    .in("status", ["pending", "running"])
    .filter("payload->>product_id", "eq", productId)
    .maybeSingle();
  if (open) return NextResponse.json({ ok: true, job_id: open.id, deduped: true });

  if (product.status === "New") {
    await supabase
      .from("products")
      .update({ status: "Selected", updated_at: new Date().toISOString() })
      .eq("id", productId)
      .eq("workspace_id", ws);
  }

  const queued = await queueChargedJob(
    supabase,
    {
      workspace_id: ws,
      type: "build_campaign",
      payload: { product_id: productId, vendor_id: product.vendor_id, assets, counts, funnel_type: funnelType },
    },
    {
      // Preserve the pre-existing claim rollback: if the atomic queue/debit is declined, the
      // product must not imply a build is still under way.
      onRollback: async () => {
        await supabase
          .from("products")
          .update({ status: "New", updated_at: new Date().toISOString() })
          .eq("id", productId)
          .eq("workspace_id", ws);
      },
    }
  );
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });

  return NextResponse.json({
    ok: true,
    job_id: queued.jobId,
    charged: queued.charged,
    ...(queued.deduped ? { deduped: true } : {}),
  });
}
