import { createAdminClient } from "@/lib/supabase/admin";

// Serves a campaign's presell/bridge HTML at a real public URL — needed so a real Meta ad's
// link_url has somewhere to point (previously this HTML only ever rendered inside an
// authenticated iframe). The campaign UUID is unguessable — that's the access control, not RLS
// (RLS would reject an anonymous read outright, so this deliberately uses the admin client,
// scoped by application code to exactly one campaign id + status='ready'). Same generic 404 for
// "not found" and "not ready" so the response code can't be used to enumerate campaign state.
export async function servePublicCampaignPage(
  campaignId: string,
  field: "presell_html" | "bridge_html"
): Promise<Response> {
  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select(field)
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();

  const html = (campaign as Record<string, unknown> | null)?.[field] as string | null | undefined;
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
