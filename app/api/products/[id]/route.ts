import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";
import { keywordsOf } from "@/lib/engine/blockTree";

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
  // page_copy is selected here but NEVER forwarded — it is read server-side to derive the compact
  // kit_meta below (the planned SEO keywords and the generated brand theme), then stripped, so
  // the response stays small for the page's poll. hoplinks_txt is deliberately absent: it holds
  // the same pasted link repeated per channel and is empty until one is pasted, so its tab showed
  // nothing — AffiliateLinkField is the real control for that value now.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      [
        "id", "product_id", "status", "created_at", "updated_at",
        "bridge_published", "bridge_html", "page_copy_edited_at", "page_copy",
        "fb_ads_md", "fb_ad_angles", "tiktok_md", "tiktok_scripts", "blog_md",
        "social_md", "social_posts", "email_md", "sms_messages",
        "embedded_image_data_url", "ad_creative_image_data_url", "images_json",
        "video_path", "video_status", "cta_url", "name",
      ].join(", ")
    )
    .eq("product_id", params.id)
    .eq("workspace_id", ws)
    .maybeSingle();

  // The cast mirrors what this handler already relied on implicitly: supabase-js cannot type a
  // joined column-string select, and the row is treated as an opaque record either way.
  return NextResponse.json({
    product,
    campaign: campaign ? withKitMeta(campaign as unknown as Record<string, unknown>) : null,
  });
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// What the build decided, small enough to show on the kit page: the search keywords stagePages
// planned and the brand theme it derived from the vendor's own sales page. Colors are re-checked
// against the same anchored hex shape sanitizeTheme enforces at save — they end up as inline
// swatch styles client-side, and a stored value is never trusted just because a write path
// validated it (the servePublicCampaignImage rule).
function withKitMeta(campaign: Record<string, unknown>) {
  const { page_copy, ...rest } = campaign;
  const tree = (page_copy ?? null) as {
    keywords?: unknown;
    theme?: {
      colors?: Record<string, unknown>;
      typography?: Record<string, unknown>;
      button?: Record<string, unknown>;
    };
  } | null;

  const hex = (v: unknown) => (typeof v === "string" && HEX_RE.test(v) ? v : null);
  const word = (v: unknown) => (typeof v === "string" && /^[a-z-]{1,24}$/.test(v) ? v : null);
  const theme = tree?.theme;

  return {
    ...rest,
    kit_meta: {
      keywords: keywordsOf(tree as never),
      theme: theme
        ? {
            primary: hex(theme.colors?.primary),
            background: hex(theme.colors?.background),
            surface: hex(theme.colors?.surface),
            text: hex(theme.colors?.text),
            headingFont: word(theme.typography?.headingFont),
            buttonShape: word(theme.button?.shape),
          }
        : null,
    },
  };
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
