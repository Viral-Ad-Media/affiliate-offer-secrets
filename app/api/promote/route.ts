import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json();
  const productId = body.product_id as string;

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

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      type: "build_campaign",
      payload: { product_id: productId, vendor_id: product.vendor_id },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, job_id: job.id });
}
