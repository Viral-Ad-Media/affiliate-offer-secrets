import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (error || !product) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("product_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ product, campaign: campaign ?? null });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  if (body.status) {
    if (!PRODUCT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const { error } = await supabase
      .from("products")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
