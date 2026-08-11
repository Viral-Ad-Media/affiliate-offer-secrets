import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyHost } from "@/lib/host";
import { IMAGE_DATA_URL_RE } from "@/lib/images/validate";
import { pickWeightedVariant, readStickyVariantId, buildStickyVariantCookie } from "@/lib/bridgeVariants";

// Which workspace's content a PUBLIC request's host is allowed to serve. Campaign UUIDs are
// unguessable, but they are also host-independent — without this check,
// acme.{root}/p/{globex-campaign-id}/bridge would serve ANOTHER tenant's funnel under acme's
// branded subdomain. On the canonical host and on tenants' custom domains nothing is restricted
// (the canonical host serves everyone by design; a custom domain's own route mapping already
// scopes it). On a workspace subdomain, only that workspace's content serves; an unknown slug
// serves nothing at all. Every mismatch is the same generic 404 as everything else here.
//
// Admin-client lookup, not the workspace_id_for_slug RPC — these are anonymous visitors, and that
// RPC folds in membership on purpose. Not an oracle: the caller collapses every miss to 404.
export async function publicWorkspaceScope(
  admin: SupabaseClient,
  host: string | null
): Promise<{ restricted: false } | { restricted: true; workspaceId: string | null }> {
  const kind = classifyHost(host);
  if (kind.kind !== "workspace") return { restricted: false };
  const { data } = await admin.from("workspaces").select("id").eq("slug", kind.slug).maybeSingle();
  return { restricted: true, workspaceId: (data?.id as string | null) ?? null };
}

function scopeRejects(
  scope: Awaited<ReturnType<typeof publicWorkspaceScope>>,
  workspaceId: string | null | undefined
): boolean {
  return scope.restricted && (!scope.workspaceId || scope.workspaceId !== workspaceId);
}

// Serves a campaign's bridge (lead-capture landing) page HTML at a real public URL — needed so a
// real Meta ad's link_url has somewhere to point (previously this HTML only ever rendered inside
// an authenticated iframe). The campaign UUID is unguessable — that's the access control, not RLS
// (RLS would reject an anonymous read outright, so this deliberately uses the admin client,
// scoped by application code to exactly one campaign id + status='ready' + bridge_published=true).
// Same generic 404 for "not found"/"not ready"/"not published" so the response code can't be used
// to enumerate campaign state. `bridge_published` (0018_bridge_publish.sql) is an explicit
// draft/publish gate on top of status='ready' — a freshly built or edited bridge page is a draft,
// not publicly reachable, until the tenant explicitly publishes it via
// app/api/campaigns/[id]/publish/route.ts. There used to be a second page variant ("presell", no
// lead capture) this took a `field` param to pick between — it's been merged into the bridge page
// (lib/engine/renderPages.ts), so this only ever serves bridge_html now.
//
// Optional A/B split (0022_bridge_variants.sql): after the campaign lookup succeeds, checks for
// active `bridge_variants` rows. None (the ~100% common case) → behavior is identical to before
// this feature existed. One or more → a visitor gets a sticky, weighted-random assignment (cookie
// `bv_{campaignId}`, 30 days) so repeat visits and the post-opt-in "reveal" step stay consistent.
// `req` is required for this — both callers (app/p/[campaignId]/bridge/route.ts,
// app/d/[[...path]]/route.ts) already receive the incoming Request and just pass it through.
export async function servePublicCampaignPage(
  campaignId: string,
  req: Request,
  requiredWorkspaceId?: string
): Promise<Response> {
  const admin = createAdminClient();
  let campaignQuery = admin
    .from("campaigns")
    .select("bridge_html, workspace_id")
    .eq("id", campaignId)
    .eq("status", "ready")
    .eq("bridge_published", true);
  if (requiredWorkspaceId) {
    campaignQuery = campaignQuery.eq("workspace_id", requiredWorkspaceId);
  }
  const { data: campaign } = await campaignQuery.maybeSingle();

  if (!campaign?.bridge_html) {
    return new Response("Not found", { status: 404 });
  }

  const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
  if (scopeRejects(scope, campaign.workspace_id as string)) {
    return new Response("Not found", { status: 404 });
  }

  let html = campaign.bridge_html as string;
  let setCookie: string | null = null;

  const { data: activeVariants } = await admin
    .from("bridge_variants")
    .select("id, weight, is_control, bridge_html")
    .eq("campaign_id", campaignId)
    .eq("status", "active");

  if (activeVariants && activeVariants.length > 0) {
    const stickyId = readStickyVariantId(req, campaignId);
    let chosen = stickyId ? activeVariants.find((v) => v.id === stickyId) : undefined;
    if (!chosen) {
      chosen = pickWeightedVariant(activeVariants);
      setCookie = buildStickyVariantCookie(campaignId, chosen.id, req.headers.get("host"));
    }

    html = chosen.is_control ? (campaign.bridge_html as string) : ((chosen.bridge_html as string) ?? html);

    // Best-effort, deliberately awaited (not fire-and-forget) — a Vercel serverless function can
    // drop an unawaited promise once the response is sent. A views-counter hiccup must never
    // break serving the actual page, hence the try/catch swallowing any error.
    try {
      await admin.rpc("increment_bridge_variant_views", { p_variant_id: chosen.id });
    } catch {
      // ignore — stats are secondary to serving the page
    }
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The page's hoplink CTA sends a Referer to ClickBank/the vendor on click — don't leak
      // the full internal URL path.
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex",
      ...(setCookie ? { "Set-Cookie": setCookie } : {}),
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
//
// Deliberately NO bridge_published condition, unlike the page above — this image's consumer is
// Instagram's servers fetching it for a feed post, which is legitimate whether or not the funnel
// is published. Gating it on publish state would 404 the fetch mid-post for any campaign whose
// funnel is still a draft.
export async function servePublicCampaignImage(campaignId: string, req?: Request): Promise<Response> {
  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("embedded_image_data_url, workspace_id")
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();

  if (campaign && req) {
    const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
    if (scopeRejects(scope, campaign.workspace_id as string)) {
      return new Response("Not found", { status: 404 });
    }
  }

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
