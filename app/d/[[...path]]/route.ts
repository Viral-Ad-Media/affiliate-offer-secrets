import { createAdminClient } from "@/lib/supabase/admin";
import { servePublicCampaignPage } from "@/lib/publicPage";

// Catch-all target for the middleware's host-mismatch rewrite (middleware.ts) — serves a
// campaign's presell/bridge page under a tenant's own connected custom domain. Reads the Host
// header directly (NOT request's URL, which reflects the rewritten internal path, not the
// original incoming domain — see middleware.ts's comment for why this distinction matters).
// Same generic 404 for "domain not verified" and "no route mapped" as the existing /p/ route
// (lib/publicPage.ts) — no status oracle.
export async function GET(request: Request, { params }: { params: { path?: string[] } }) {
  const host = request.headers.get("host") ?? "";
  const path = (params.path ?? []).join("/");

  const admin = createAdminClient();

  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id")
    .eq("domain", host)
    .eq("status", "verified")
    .maybeSingle();
  if (!domainRow) return new Response("Not found", { status: 404 });

  const { data: routeRow } = await admin
    .from("custom_domain_routes")
    .select("campaign_id, destination")
    .eq("domain_id", domainRow.id)
    .eq("path", path)
    .maybeSingle();
  if (!routeRow) return new Response("Not found", { status: 404 });

  return servePublicCampaignPage(
    routeRow.campaign_id,
    routeRow.destination === "bridge" ? "bridge_html" : "presell_html"
  );
}
