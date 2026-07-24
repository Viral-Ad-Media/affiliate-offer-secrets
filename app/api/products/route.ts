import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: products, error } = await supabase
    .from("products")
    .select("*, campaigns(id, status)")
    .eq("user_id", user.id)
    .order("score", { ascending: false, nullsFirst: false })
    .order("gravity", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = (products ?? []).map((p: any) => {
    const { campaigns, ...rest } = p;
    const campaign = Array.isArray(campaigns) ? campaigns[0] : campaigns;
    return { ...rest, campaign_id: campaign?.id ?? null, campaign_status: campaign?.status ?? null };
  });

  return NextResponse.json(shaped);
}
