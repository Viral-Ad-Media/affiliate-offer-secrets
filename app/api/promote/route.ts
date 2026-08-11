import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { normalizeKitAssets } from "@/lib/kitAssets";
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

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", ws)
    .single();
  if (productError || !product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const { data: connection } = await supabase
    .from("network_connections")
    .select("affiliate_id")
    .eq("workspace_id", ws)
    .eq("network", product.network)
    .maybeSingle();
  if (!connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${product.network} affiliate ID first` },
      { status: 400 }
    );
  }

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
      payload: { product_id: productId, vendor_id: product.vendor_id, assets },
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
