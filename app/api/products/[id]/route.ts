import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .single();
  if (error || !product) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Explicit columns, NOT select("*"). campaigns rows average 166 kB and reach 766 kB — the bulk
  // of it being page_copy (~47 kB), the legacy presell_html/landing_md, and the base64 image — and
  // the product page re-fetches this on an interval, so `*` meant re-sending a page-sized payload
  // over and over. page_copy in particular is pure waste here: the funnel editor lives on
  // /funnels/[campaignId] and reads it there; this page only ever renders bridge_html.
  //
  // Anything a child component on that page needs must be listed here — dropping a column is
  // invisible to tsc and shows up as an empty tab.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      [
        "id", "product_id", "status", "created_at", "updated_at",
        "bridge_published", "bridge_html", "page_copy_edited_at",
        "fb_ads_md", "fb_ad_angles", "tiktok_md", "blog_md",
        "social_md", "social_posts", "email_md", "sms_messages", "hoplinks_txt",
        "embedded_image_data_url", "ad_creative_image_data_url", "images_json",
        "video_path", "video_status", "cta_url", "name",
      ].join(", ")
    )
    .eq("product_id", params.id)
    .eq("workspace_id", ws)
    .maybeSingle();

  return NextResponse.json({ product, campaign: campaign ?? null });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json();
  if (body.status) {
    if (!PRODUCT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const { error } = await supabase
      .from("products")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("workspace_id", ws);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
