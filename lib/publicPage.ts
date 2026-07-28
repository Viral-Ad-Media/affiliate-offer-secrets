import { createAdminClient } from "@/lib/supabase/admin";
import { IMAGE_DATA_URL_RE } from "@/lib/images/validate";

// Serves a campaign's bridge (lead-capture landing) page HTML at a real public URL — needed so a
// real Meta ad's link_url has somewhere to point (previously this HTML only ever rendered inside
// an authenticated iframe). The campaign UUID is unguessable — that's the access control, not RLS
// (RLS would reject an anonymous read outright, so this deliberately uses the admin client,
// scoped by application code to exactly one campaign id + status='ready'). Same generic 404 for
// "not found" and "not ready" so the response code can't be used to enumerate campaign state.
// There used to be a second page variant ("presell", no lead capture) this took a `field` param
// to pick between — it's been merged into the bridge page (lib/engine/renderPages.ts), so this
// only ever serves bridge_html now.
export async function servePublicCampaignPage(campaignId: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("bridge_html")
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();

  const html = campaign?.bridge_html as string | null | undefined;
  if (!html) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The page's hoplink CTA sends a Referer to ClickBank/the vendor on click — don't leak
      // the full internal URL path.
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex",
    },
  });
}

// Serves a campaign's embedded product image as a real, standalone, publicly-fetchable URL —
// needed because Instagram's media-creation endpoint requires a fetchable image_url, unlike
// Facebook's Photos API which accepts direct byte upload. Same UUID+status='ready' scoping as
// servePublicCampaignPage. Re-validates the stored value against the same allowlist regex used
// everywhere else this app touches an embedded image (lib/images/validate.ts) — never trust the
// DB row's format is guaranteed just because the write paths validate it; a non-matching value is
// treated as "not found", not served with whatever Content-Type it happens to claim.
export async function servePublicCampaignImage(campaignId: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("embedded_image_data_url")
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();

  const dataUrl = campaign?.embedded_image_data_url as string | null | undefined;
  const match = dataUrl ? IMAGE_DATA_URL_RE.exec(dataUrl) : null;
  if (!dataUrl || !match) {
    return new Response("Not found", { status: 404 });
  }

  const contentType = `image/${match[1]}`;
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      // The image can change (re-edit) or the campaign can leave 'ready' status — don't let
      // intermediate proxies/CDNs cache a stale copy the way they would a versioned static asset.
      "Cache-Control": "no-store",
    },
  });
}
