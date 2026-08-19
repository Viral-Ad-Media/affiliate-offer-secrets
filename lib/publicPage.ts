import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicNotFound } from "@/lib/notFoundPage";
import { classifyHost } from "@/lib/host";
import { IMAGE_DATA_URL_RE, isOwnCloudinaryUrl } from "@/lib/images/validate";
import { pickWeightedVariant, readStickyVariantId, buildStickyVariantCookie } from "@/lib/bridgeVariants";
import { recordFunnelPageView } from "@/lib/funnelPageStats";
import { rawTrackingSnippets, type TrackingSettings } from "@/lib/engine/tracking";

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
  requiredWorkspaceId?: string,
  // Raw custom tracking snippets (lib/engine/tracking.ts) are spliced into the served HTML ONLY
  // when this is true — set exclusively by the custom-domain route (app/d/[[...path]]), which
  // resolves through custom_domain_routes joined to a status='verified' custom_domains row, so
  // "true here" means "this is the tenant's own verified domain" by construction. The shared /p/
  // route never sets it, so raw markup never runs on the app's own session-cookie origin.
  opts?: { rawTracking?: boolean }
): Promise<Response> {
  const admin = createAdminClient();
  // PUBLISHED + has HTML is the gate. `status` is deliberately NOT part of it.
  //
  // `campaigns.status` describes the last BUILD, not the page. A rebuild that fails — most often
  // because the Anthropic account ran out of credit — sets status='error' while leaving the
  // existing bridge_html completely intact, and gating on 'ready' therefore took a live funnel
  // offline over a failure that had nothing to do with the page being served. That happened here:
  // a regenerate of a published funnel failed and 404'd real ad traffic for a page whose HTML was
  // 33,943 bytes of perfectly serveable content.
  //
  // Removing it costs nothing this gate was providing. A campaign that has never finished a build
  // has no bridge_html (so the check below refuses it), and a draft has bridge_published=false —
  // which remains the real, tenant-controlled switch for pulling a page down. Stage output is
  // committed per stage, so a failed rebuild leaves the PREVIOUS render in place rather than a
  // half-written one.
  let campaignQuery = admin
    .from("campaigns")
    .select("bridge_html, workspace_id, tracking")
    .eq("id", campaignId)
    .eq("bridge_published", true);
  if (requiredWorkspaceId) {
    campaignQuery = campaignQuery.eq("workspace_id", requiredWorkspaceId);
  }
  const { data: campaign } = await campaignQuery.maybeSingle();

  if (!campaign?.bridge_html) {
    return publicNotFound(req.headers.get("host"));
  }

  const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
  if (scopeRejects(scope, campaign.workspace_id as string)) {
    // Byte-identical to the branch above, deliberately: "no such campaign" and "not yours to see
    // on this host" must be indistinguishable, or the difference enumerates campaigns.
    return publicNotFound(req.headers.get("host"));
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

    // Counted once per VISITOR, not once per request — hence the `setCookie` guard, which is only
    // set on the visit that assigns the variant. A refresh, a back button, or someone re-opening
    // the page from their history keeps the same sticky variant and must not count again.
    //
    // This changed: it used to increment unconditionally. Two things were wrong with that. The
    // rate shown beside it (leads ÷ views) was really leads-per-pageview and read lower than the
    // real opt-in rate; and the split test's confidence figure treats each view as an independent
    // trial, which repeat views of one page by one person are not — feeding them in makes the
    // test anti-conservative, overstating certainty in the exact direction that gets a test
    // called early. Historical rows carry the old inflated counts, so rates on a test that was
    // already running will step UP at this deploy rather than being restated.
    //
    // Best-effort, deliberately awaited (not fire-and-forget) — a Vercel serverless function can
    // drop an unawaited promise once the response is sent. A views-counter hiccup must never
    // break serving the actual page, hence the try/catch swallowing any error.
    if (setCookie) {
      try {
        await admin.rpc("increment_bridge_variant_views", { p_variant_id: chosen.id });
      } catch {
        // ignore — stats are secondary to serving the page
      }
    }
  }

  // DELIBERATELY no Cache-Control, unlike the blog pages (app/b/[...path]/route.ts) which do
  // carry a short shared cache. This response is not the same bytes for every visitor and must
  // never be served from a shared cache:
  //
  //   - It can carry Set-Cookie. A shared cache would hand ONE visitor's sticky `bv_{campaignId}`
  //     assignment to everybody downstream of it, so every later visitor inherits that variant.
  //     That doesn't just skew the split test, it silently ends it.
  //   - The weighted pick has to run per visitor, and `increment_bridge_variant_views` has to run
  //     on the assigning visit. A cache hit skips this function entirely, so views stop counting
  //     while leads keep arriving — which moves the computed opt-in rate, and the confidence
  //     figure derived from it, in the direction that gets a test called early.
  //   - `bridge_published` is a real gate a tenant may use to pull a page down. It is the exact
  //     staleness bug lib/supabase/admin.ts documents, one layer further out.
  //
  // This is not hypothetical for this deployment: measured live, every published funnel has active
  // variants, so the "no variants, deterministic response" case that would be safe to cache is
  // currently the empty set. If caching this is revisited, gate it on there being no active
  // variants AND no Set-Cookie, and keep the TTL under the publish gate's tolerance.
  //
  // The cost this leaves on the table is real but is NOT a caching problem: bridge_html averages
  // 105 kB and reaches 276 kB, almost all of it one inline base64 image that never changes. Moving
  // that image to a URL would shrink the page ~20x and let the image cache on its own, which is
  // the actual fix. See content rule 9 before doing it — the "never hotlinked" rule is about
  // vendor URLs, not about serving our own bytes.
  // Raw custom tracking snippets, spliced in only on the tenant's own verified custom domain
  // (opts.rawTracking) — never baked into the stored bridge_html the shared origin serves. See
  // TrackingSettings.custom_head for the full safety argument.
  if (opts?.rawTracking) {
    html = spliceRawTracking(html, rawTrackingSnippets(campaign.tracking as TrackingSettings | null));
  }

  // Funnel-map views counter (0110) — same once-per-visitor discipline as the variant counter
  // above, deduped by its own fs_ cookie so it counts whether or not a split test is running.
  const statsCookie = await recordFunnelPageView(admin, req, campaignId, "optin");

  // A Headers object, not a literal: this response can now carry TWO Set-Cookie headers (the
  // sticky variant assignment and the views dedupe), and an object key can only hold one.
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    // The page's hoplink CTA sends a Referer to ClickBank/the vendor on click — don't leak
    // the full internal URL path.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Robots-Tag": "noindex",
  });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  if (statsCookie) headers.append("Set-Cookie", statsCookie);

  return new Response(html, { status: 200, headers });
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

  // Deliberately NOT the HTML 404 page the routes above serve. This endpoint answers an <img src>
  // and Instagram's media fetcher — nothing here ever renders a document, so a styled page would
  // be bytes no one sees. The property that matters (one indistinguishable 404 for every reason)
  // holds either way.
  if (campaign && req) {
    const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
    if (scopeRejects(scope, campaign.workspace_id as string)) {
      return new Response("Not found", { status: 404 });
    }
  }

  // Read into its own const rather than reusing `dataUrl` below: isOwnCloudinaryUrl is a type
  // predicate, so a negative result would narrow the shared variable to `never` and the data-URI
  // branch would stop compiling. "Not one of our URLs" plainly does not mean "not a string".
  const stored = campaign?.embedded_image_data_url as string | null | undefined;

  // Migrated campaigns hold a Cloudinary URL here rather than bytes. Redirect instead of 404ing:
  // this route's whole reason to exist is that Instagram's media-creation endpoint needs a
  // FETCHABLE url (lib/meta/client.ts documents that it has no byte-upload path), and a campaign
  // whose hero moved to Cloudinary would otherwise stop being postable.
  //
  // isOwnCloudinaryUrl, not a bare startsWith — this value becomes a Location header, so the same
  // anchored check that guards it as an <img src> guards it here. Callers that can use the URL
  // directly should prefer it (app/api/instagram/post/route.ts does) and never reach this branch;
  // the redirect is what keeps every other consumer working.
  if (isOwnCloudinaryUrl(stored)) {
    return new Response(null, {
      status: 302,
      headers: { Location: stored, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
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


// Splice raw custom tracking snippets into a served funnel document. Position-correct per each
// snippet's slot; if the marker is missing (never, for our own rendered pages) it degrades to
// prepend/append rather than dropping the snippet. String replace, once each — the markup is the
// tenant's own, injected only on their own verified domain (see servePublicCampaignPage).
function spliceRawTracking(html: string, s: { head: string; body: string; footer: string }): string {
  let out = html;
  if (s.head) out = out.includes("</head>") ? out.replace("</head>", `${s.head}</head>`) : s.head + out;
  if (s.body) out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => `${m}${s.body}`) : s.body + out;
  if (s.footer) out = out.includes("</body>") ? out.replace("</body>", `${s.footer}</body>`) : out + s.footer;
  return out;
}
